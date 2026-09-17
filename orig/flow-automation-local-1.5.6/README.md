# Flow Automation Local 1.5.6.1

Bản fork local dựa trên cấu trúc/engine của extension mẫu 1.5.6, tập trung vào automation Google Flow nhưng loại bỏ backend tài khoản, Firebase/GAS, Google OAuth và cơ chế chặn/đọc Authorization header.

## Tính năng chính

- Side Panel chạy prompt hàng loạt.
- Chọn range `Từ dòng / Đến dòng` hoặc danh sách chỉ số tùy ý.
- Video mode / Image mode, output count, aspect ratio.
- Random delay, retry, theo dõi card/tile và progress.
- Character Sync (`@Tên`), Keyframe Sync (`(@start, @end)`), Voice Sync theo engine mẫu.
- Auto Rename: ưu tiên thao tác qua UI Flow; nếu Cloud rename thất bại thì tên file download vẫn được ép ở Chrome Downloads.
- Download từng media theo quality hoặc Download Project ZIP.
- Lưu project vào `chrome.storage.local`, resume sau reload/F5.
- Group/grid view + zoom.
- Selector picker cho nút menu tile khi Flow đổi UI.
- Auto Shutdown tùy chọn qua Native Messaging Host.

## Khác biệt bảo mật so với file mẫu

- **Không có `sniffer.js`.**
- **Không đọc `Authorization` header/token phiên của Google Flow.**
- **Không gọi Firebase, Google Apps Script, ipify hoặc backend thanh toán của tác giả mẫu.**
- **Không yêu cầu quyền `identity` và không có Google OAuth.**
- Kiểm tra trạng thái hoàn thành dựa trên DOM của Flow thay vì private workflow status RPC.
- Cloud Rename dùng giao diện người dùng Flow thay vì private API/token. Vì vậy rename có thể kém ổn định hơn bản mẫu nếu Google thay UI.

## Cài đặt

1. Giải nén thư mục extension.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Chọn **Load unpacked** và trỏ tới thư mục `flow-automation-local-1.5.6`.
5. Mở `https://flow.google.com/`, vào project cần chạy và refresh trang một lần.
6. Bấm icon extension để mở Side Panel.

## Auto Shutdown (không bắt buộc)

Không cài Native Host nếu bạn không cần tự tắt Windows.

Nếu cần:

1. Vào `chrome://extensions`, copy **ID** của `Flow Automation Local`.
2. Máy cần Python + PyInstaller (`python -m pip install pyinstaller`).
3. Mở PowerShell ở thư mục `native-host` và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_native_host.ps1 -ExtensionId YOUR_EXTENSION_ID -Browser Chrome
```

4. Restart Chrome và bấm **Test Native Host** trong phần Settings.

Host chỉ chấp nhận 3 action: `ping`, `shutdown`, `cancel_shutdown`; không hỗ trợ chạy lệnh tùy ý.

## Lưu ý vận hành

Google Flow thay đổi DOM khá thường xuyên. Nếu tải xuống không mở đúng menu, dùng **Settings → Hiệu chỉnh selector → Chọn nút menu của tile** rồi click đúng nút ba chấm trên một tile Flow. Sau đó selector được lưu local.

Nếu Auto Rename UI không thành công, automation vẫn tiếp tục; khi download, background service worker sẽ ép tên file theo prompt/custom rename list.
