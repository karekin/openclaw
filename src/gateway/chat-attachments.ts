import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estimateBase64DecodedBytes } from "../media/base64.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

type ParseMessageWithAttachmentsOptions = {
  maxBytes?: number;
  log?: AttachmentLog;
  materializeFilePaths?: boolean;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

const MATERIALIZED_ATTACHMENT_ROOT = path.join(os.tmpdir(), "openclaw-chat-attachments");
const MATERIALIZED_ATTACHMENT_TTL_MS = 6 * 60 * 60 * 1000;
const ATTACHMENT_PATH_BLOCK_START = "<openclaw_attachment_paths>";
const ATTACHMENT_PATH_BLOCK_END = "</openclaw_attachment_paths>";

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isValidBase64(value: string): boolean {
  // Minimal validation; avoid full decode allocations for large payloads.
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

function sanitizeAttachmentFileName(label: string): string {
  const base = path.basename(label).trim();
  const sanitized = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return sanitized.replace(/^-+|-+$/g, "") || "attachment";
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/bmp":
      return ".bmp";
    case "image/tiff":
      return ".tiff";
    case "image/svg+xml":
      return ".svg";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return ".img";
  }
}

async function materializeImageAttachment(params: {
  base64: string;
  mimeType: string;
  label: string;
}): Promise<string> {
  await fs.mkdir(MATERIALIZED_ATTACHMENT_ROOT, { recursive: true });
  await purgeExpiredMaterializedAttachments();
  const dir = await fs.mkdtemp(path.join(MATERIALIZED_ATTACHMENT_ROOT, "att-"));
  const safeName = sanitizeAttachmentFileName(params.label);
  const currentExt = path.extname(safeName);
  const finalName = currentExt ? safeName : `${safeName}${extensionFromMime(params.mimeType)}`;
  const absPath = path.join(dir, finalName);
  await fs.writeFile(absPath, Buffer.from(params.base64, "base64"));
  scheduleMaterializedAttachmentCleanup(dir);
  return absPath;
}

function appendMaterializedAttachmentPaths(message: string, filePaths: string[]): string {
  if (filePaths.length === 0) {
    return message;
  }
  const lines = [
    ATTACHMENT_PATH_BLOCK_START,
    "Chat attachment file paths (use these directly for file-based tools/scripts. Attached images are already visible in the model context, so do not call `image` just to re-read them, and do not call `write` just to save them first):",
    ...filePaths.map((filePath) => `[Image: source: ${filePath}]`),
    ATTACHMENT_PATH_BLOCK_END,
  ];
  const trimmed = message.trimEnd();
  return trimmed ? `${trimmed}\n\n${lines.join("\n")}` : lines.join("\n");
}

function scheduleMaterializedAttachmentCleanup(dir: string) {
  const timer = setTimeout(() => {
    void fs.rm(dir, { recursive: true, force: true });
  }, MATERIALIZED_ATTACHMENT_TTL_MS);
  timer.unref?.();
}

async function purgeExpiredMaterializedAttachments(now = Date.now()) {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(MATERIALIZED_ATTACHMENT_ROOT, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("att-"))
      .map(async (entry) => {
        const absDir = path.join(MATERIALIZED_ATTACHMENT_ROOT, entry.name);
        try {
          const stat = await fs.stat(absDir);
          if (now - stat.mtimeMs >= MATERIALIZED_ATTACHMENT_TTL_MS) {
            await fs.rm(absDir, { recursive: true, force: true });
          }
        } catch {
          // Ignore best-effort cleanup errors for temp directories.
        }
      }),
  );
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: ParseMessageWithAttachmentsOptions,
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000; // decoded bytes (5,000,000)
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [] };
  }

  const images: ChatImageContent[] = [];
  const materializedPaths: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: true,
      requireImageMime: false,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64: b64, label, mime } = normalized;

    const providedMime = normalizeMime(mime);
    const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
    if (sniffedMime && !isImageMime(sniffedMime)) {
      log?.warn(`attachment ${label}: detected non-image (${sniffedMime}), dropping`);
      continue;
    }
    if (!sniffedMime && !isImageMime(providedMime)) {
      log?.warn(`attachment ${label}: unable to detect image mime type, dropping`);
      continue;
    }
    if (sniffedMime && providedMime && sniffedMime !== providedMime) {
      log?.warn(
        `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
      );
    }

    images.push({
      type: "image",
      data: b64,
      mimeType: sniffedMime ?? providedMime ?? mime,
    });
    if (opts?.materializeFilePaths) {
      materializedPaths.push(
        await materializeImageAttachment({
          base64: b64,
          mimeType: sniffedMime ?? providedMime ?? mime,
          label,
        }),
      );
    }
  }

  return {
    message: appendMaterializedAttachmentPaths(message, materializedPaths),
    images,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64, label, mime } = normalized;

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${base64})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
