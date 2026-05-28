# 豆包语音 API 参考

本 skill 的语音生成以当前项目脚本和本参考文件记录的 provider 参数为准。

## 默认参数

- Provider：火山 / 豆包 TTS
- Endpoint：`https://openspeech.bytedance.com/api/v3/tts/unidirectional`
- Resource ID：`seed-tts-2.0`
- 默认音色：儒雅逸辰 2.0
- 默认音色 key / speaker：`zh_male_ruyayichen_uranus_bigtts`
- 默认语速：约 `1.25x`
- API 参数：`speech_rate=25`
- 默认采样率：`24000`
- 默认格式：`mp3`
- 默认 `pitch_rate=0`
- 默认 `volume_ratio=1.2`

## 密钥来源

只允许从运行环境读取密钥：

```bash
export DOUBAO_TTS_API_KEY=...
# 或
export VOLCENGINE_TTS_API_KEY=...
```

本机也允许使用：

```text
~/.config/doubao-tts/env
```

该文件只能存本机密钥，不得提交到项目或 skill。

## 请求形状

HTTP headers：

```text
Content-Type: application/json
X-Api-Key: <api key>
X-Api-Resource-Id: seed-tts-2.0
X-Api-Request-Id: <uuid>
```

Body：

```json
{
  "req_params": {
    "text": "口播文本",
    "speaker": "zh_male_ruyayichen_uranus_bigtts",
    "audio_params": {
      "format": "mp3",
      "sample_rate": 24000,
      "speech_rate": 25,
      "pitch_rate": 0,
      "volume_ratio": 1.2
    }
  }
}
```

## 响应处理

接口返回 JSONL。每一行可能包含：

- `data`
- 或 `payload_msg.data`

这些字段是 base64 音频块。把所有块按顺序解码并拼接，写成 MP3 文件。

## 工作流要求

- 默认使用 `--mode whole`，把所有 beat 文本按顺序拼成一条完整口播，只请求一次
  豆包 TTS，并直接写 `05_video/audio/master.mp3`。
- 用 `ffprobe` 读取 `master.mp3` 的真实总时长。
- `voice_timeline.json` 必须保留一 beat 一段的 `segments`，用于图片、镜头和字幕
  对齐；没有 forced alignment 时，可先用上一版真实分段时长作为权重估算边界。
- 如果已有 `05_video/audio/forced_alignment.json`，运行 `npm run align-audio` 用
  真实对齐边界替换估算时间戳。
- 只有整篇请求失败、接口文本长度受限，或用户明确要求时，才降级为
  `--mode segmented` 串行分段请求，再用 `ffmpeg concat` 合成 `master.mp3`。
