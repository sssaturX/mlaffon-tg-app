#!/usr/bin/env python3
import argparse
import pathlib
import sys


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

    try:
        from lib_speak import Speaker
        from lib_sl_text import SeleroText
    except Exception as exc:
        print(
            "SpeakerPy imports failed. Install it in the API runtime: "
            "python3 -m pip install speakerpy",
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
        speaker.to_mp3(
            text=SeleroText(text, to_language=args.language),
            name_text=args.name,
            sample_rate=args.sample_rate,
            audio_dir=audio_dir,
            speed=args.speed,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 4

    output_path = audio_dir / f"{args.name}.mp3"
    if not output_path.exists():
        print(f"Output file was not created: {output_path}", file=sys.stderr)
        return 5

    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
