"""文字转语音：用 Edge TTS（微软，免费、无需 key）。

用法：
  python tts.py "<文本>" <输出.mp3> [音色]

输出 JSON：{ ok, file, voice, chars, error }
"""
import asyncio
import json
import os
import sys

import edge_tts

DEFAULT_VOICE = os.environ.get("TTS_VOICE", "zh-CN-XiaoyiNeural")


async def main() -> None:
    text = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    out = sys.argv[2] if len(sys.argv) > 2 else "out.mp3"
    voice = (sys.argv[3] if len(sys.argv) > 3 else DEFAULT_VOICE) or DEFAULT_VOICE
    if not text:
        print(json.dumps({"ok": False, "error": "没有文本"}, ensure_ascii=False))
        return
    if len(text) > 600:
        text = text[:600]
    try:
        tone_rate = os.environ.get("TTS_RATE", "+0%")
        tone_pitch = os.environ.get("TTS_PITCH", "+0Hz")
        tone_volume = os.environ.get("TTS_VOLUME", "+0%")
        comm = edge_tts.Communicate(text, voice, rate=tone_rate, volume=tone_volume, pitch=tone_pitch)
        await comm.save(out)
        size = os.path.getsize(out) if os.path.exists(out) else 0
        print(json.dumps({
            "ok": size > 0,
            "file": out,
            "voice": voice,
            "chars": len(text),
            "bytes": size,
            "rate": tone_rate,
            "pitch": tone_pitch,
        }, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)[:300], "voice": voice}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
