# Security notes

- Host permissions chỉ giới hạn ở Google Flow/Labs.
- Không intercept fetch/XMLHttpRequest và không thu thập bearer token.
- Không truyền prompt, email, IP, session hay usage telemetry tới backend bên thứ ba.
- Project/prompt/settings chỉ lưu trong `chrome.storage.local` của browser profile.
- `nativeMessaging` chỉ cần cho Auto Shutdown. Có thể xóa permission này khỏi `manifest.json` nếu không dùng.
- Native Host mẫu chỉ hỗ trợ shutdown/cancel/ping và giới hạn delay shutdown 10–3600 giây.
