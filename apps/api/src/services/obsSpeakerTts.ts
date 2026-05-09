import { createHash } from "node:crypto";
import { access, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { singleFlight } from "../lib/singleFlight.js";
import type { ObsWidgetSpeakerpyVoice } from "./obsPurchaseWidget.js";

const execFileAsync = promisify(execFile);

const __dir = dirname(fileURLToPath(import.meta.url));

const SPEAKERPY_VOICES: ObsWidgetSpeakerpyVoice[] = [
  "aidar",
  "baya",
  "kseniya",
  "xenia",
  "eugene",
  "random",
];

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TEXT_LENGTH = 600;

export type SpeakerpyTtsInput = {
  text: string;
  voice: ObsWidgetSpeakerpyVoice;
  speed?: number;
};

export type SpeakerpyTtsResult =
  | { ok: true; path: string; contentType: "audio/mpeg" }
  | { ok: false; status: number; code: string; message: string };

export function isSpeakerpyVoice(value: string): value is ObsWidgetSpeakerpyVoice {
  return SPEAKERPY_VOICES.includes(value as ObsWidgetSpeakerpyVoice);
}

function speakerpyEnabled(): boolean {
  return process.env.SPEAKERPY_TTS_ENABLED === "1";
}

function pythonBin(): string {
  return process.env.SPEAKERPY_PYTHON_BIN?.trim() || "python3";
}

function cacheDir(): string {
  return resolve(
    process.env.SPEAKERPY_CACHE_DIR?.trim() ||
      join(tmpdir(), "mlaffon-speakerpy-tts")
  );
}

function scriptPath(): string {
  const configured = process.env.SPEAKERPY_SCRIPT_PATH?.trim();
  if (configured) return resolve(configured);
  return resolve(__dir, "../../scripts/speakerpy_tts.py");
}

function modelId(): string {
  return process.env.SPEAKERPY_MODEL_ID?.trim() || "ru_v3";
}

function language(): string {
  return process.env.SPEAKERPY_LANGUAGE?.trim() || "ru";
}

function device(): string {
  return process.env.SPEAKERPY_DEVICE?.trim() || "cpu";
}

function timeoutMs(): number {
  const n = Number.parseInt(process.env.SPEAKERPY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(n) && n >= 5_000 ? n : DEFAULT_TIMEOUT_MS;
}

function sampleRate(): number {
  const n = Number.parseInt(process.env.SPEAKERPY_SAMPLE_RATE ?? "", 10);
  return Number.isFinite(n) && [8000, 24000, 48000].includes(n)
    ? n
    : DEFAULT_SAMPLE_RATE;
}

function normalizeSpeed(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.min(1.5, Math.max(0.75, raw));
}

function normalizeText(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanupOldCacheFiles(dir: string): Promise<void> {
  const maxAgeMs = Number.parseInt(
    process.env.SPEAKERPY_CACHE_MAX_AGE_MS ?? String(24 * 60 * 60 * 1000),
    10
  );
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return;

  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".mp3") || name.endsWith(".txt"))
        .map(async (name) => {
          const path = join(dir, name);
          try {
            const s = await stat(path);
            if (s.mtimeMs < cutoff) await unlink(path);
          } catch {
            /* ignore cleanup races */
          }
        })
    );
  } catch {
    /* cache cleanup is best-effort */
  }
}

export async function generateSpeakerpyTts(
  input: SpeakerpyTtsInput
): Promise<SpeakerpyTtsResult> {
  if (!speakerpyEnabled()) {
    return {
      ok: false,
      status: 503,
      code: "speakerpy_disabled",
      message: "SpeakerPy TTS is disabled.",
    };
  }

  const text = normalizeText(input.text);
  if (!text) {
    return { ok: false, status: 400, code: "empty_text", message: "Text is empty." };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: "text_too_long",
      message: `Text is too long. Max ${MAX_TEXT_LENGTH} characters.`,
    };
  }
  if (!isSpeakerpyVoice(input.voice)) {
    return {
      ok: false,
      status: 400,
      code: "bad_voice",
      message: "Unsupported SpeakerPy voice.",
    };
  }

  const speed = normalizeSpeed(input.speed);
  const key = createHash("sha256")
    .update(JSON.stringify({ v: 1, text, voice: input.voice, speed, modelId: modelId() }))
    .digest("hex")
    .slice(0, 32);
  const dir = cacheDir();
  const outPath = join(dir, `${key}.mp3`);
  const textPath = join(dir, `${key}.txt`);

  return singleFlight(`speakerpy:${key}`, async () => {
    await mkdir(dir, { recursive: true });
    if (await fileExists(outPath)) {
      return { ok: true as const, path: outPath, contentType: "audio/mpeg" as const };
    }

    await writeFile(textPath, text, "utf-8");

    try {
      await execFileAsync(
        pythonBin(),
        [
          scriptPath(),
          "--text-file",
          textPath,
          "--audio-dir",
          dir,
          "--name",
          key,
          "--voice",
          input.voice,
          "--model-id",
          modelId(),
          "--language",
          language(),
          "--device",
          device(),
          "--sample-rate",
          String(sampleRate()),
          "--speed",
          String(speed),
        ],
        { timeout: timeoutMs(), maxBuffer: 1024 * 1024 }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "SpeakerPy failed.";
      return {
        ok: false as const,
        status: 503,
        code: "speakerpy_failed",
        message,
      };
    } finally {
      void cleanupOldCacheFiles(dir);
    }

    if (!(await fileExists(outPath))) {
      return {
        ok: false as const,
        status: 503,
        code: "speakerpy_no_output",
        message: "SpeakerPy did not create an audio file.",
      };
    }

    return { ok: true as const, path: outPath, contentType: "audio/mpeg" as const };
  });
}
