import sys, os, json, io

# Windows 上 Python 的 stdout 默认是 GBK，输出中文到管道再被当 UTF-8 读就是乱码。
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("OMP_NUM_THREADS", str(max(1, (os.cpu_count() or 4) // 2)))

from faster_whisper import WhisperModel

audio = sys.argv[1]
model_dir = os.environ.get("WHISPER_MODEL_DIR", r"D:/dsh-data/whisper/models")
# 优先 small（中文准得多），没有就退 base；也可以 WHISPER_SIZE=base 临时换回去。
size = os.environ.get("WHISPER_SIZE", "small")
model_size = os.environ.get("WHISPER_MODEL", "")
if not model_size:
    for cand in (size, "small", "base"):
        local = os.path.join(model_dir, f"faster-whisper-{cand}")
        if os.path.isdir(local):
            model_size = local
            break
    if not model_size:
        model_size = size
lang = os.environ.get("WHISPER_LANG", "zh")

vad = os.environ.get("WHISPER_VAD", "1") != "0"

# small 模型常吐繁体，转成简体再交给模型，不然读起来像港台字幕。
try:
    import zhconv as _zhconv

    def to_cn(text):
        return _zhconv.convert(text, "zh-cn")
except Exception:
    def to_cn(text):
        return text

model = WhisperModel(model_size, device="cpu", compute_type="int8", download_root=model_dir)
segments, info = model.transcribe(audio, language=lang, vad_filter=vad, beam_size=1)

chunks = []
for seg in segments:
    text = to_cn((seg.text or "").strip())
    if text:
        chunks.append({"from": round(float(seg.start), 2), "to": round(float(seg.end), 2), "text": text})

print(json.dumps({
    "ok": True,
    "text": "".join(c["text"] for c in chunks),
    "chunks": chunks,
    "lang": info.language,
    "duration": round(float(info.duration), 2),
    "model": model_size,
}, ensure_ascii=False))
