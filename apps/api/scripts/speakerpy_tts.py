#!/usr/bin/env python3
import argparse
import io
import os
import pathlib
import sys


def configure_runtime_cache(audio_dir: pathlib.Path) -> None:
    cache_root = audio_dir.parent
    nltk_dir = pathlib.Path(
        os.environ.get("SPEAKERPY_NLTK_DATA")
        or os.environ.get("NLTK_DATA")
        or cache_root / "nltk"
    )
    nltk_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("NLTK_DATA", str(nltk_dir))


def import_speakerpy():
    try:
        from speakerpy.lib_sl_text import SeleroText
        from speakerpy.lib_speak import Speaker
    except ModuleNotFoundError as exc:
        if exc.name not in {"speakerpy", "speakerpy.lib_sl_text", "speakerpy.lib_speak"}:
            raise
        from lib_sl_text import SeleroText
        from lib_speak import Speaker

    from pydub import AudioSegment
    import soundfile

    return Speaker, SeleroText, AudioSegment, soundfile


def apply_speed(segment, speed: float, sample_rate: int):
    if speed == 1.0:
        return segment
    adjusted = segment._spawn(
        segment.raw_data,
        overrides={"frame_rate": int(segment.frame_rate * speed)},
    )
    return adjusted.set_frame_rate(sample_rate)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate OBS TTS audio with SpeakerPy.")
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--audio-dir", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--model-id", default="ru_v3")
    parser.add_argument("--language", default="ru")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--speed", type=float, default=1.0)
    args = parser.parse_args()

    text_path = pathlib.Path(args.text_file)
    audio_dir = pathlib.Path(args.audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    output_path = audio_dir / f"{args.name}.mp3"

    configure_runtime_cache(audio_dir)

    try:
        Speaker, SeleroText, AudioSegment, soundfile = import_speakerpy()
    except Exception as exc:
        print(
            "SpeakerPy imports failed. Install it in the API runtime: "
            "python3 -m pip install -r apps/api/scripts/requirements-speakerpy.txt",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 2

    text = text_path.read_text(encoding="utf-8").strip()
    if not text:
        print("Empty text", file=sys.stderr)
        return 3

    try:
        speaker = Speaker(
            model_id=args.model_id,
            language=args.language,
            speaker=args.voice,
            device=args.device,
        )
        combined = AudioSegment.empty()
        for chunk in SeleroText(text, to_language=args.language).chunk():
            audio = speaker._synthesize_text(
                chunk,
                sample_rate=args.sample_rate,
                put_accent=True,
                put_yo=True,
            )
            with io.BytesIO() as buffer:
                soundfile.write(buffer, audio, args.sample_rate, format="WAV")
                buffer.seek(0)
                combined += apply_speed(
                    AudioSegment.from_wav(buffer),
                    args.speed,
                    args.sample_rate,
                )
        combined.export(output_path, format="mp3")
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 4

    if not output_path.exists():
        print(f"Output file was not created: {output_path}", file=sys.stderr)
        return 5

    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
