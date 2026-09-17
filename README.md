# Flow Automation Local

Tiện ích Chrome (Manifest V3) tự động hoá thao tác prompt hàng loạt trên
**Google Flow** (`flow.google.com`). Chạy **hoàn toàn cục bộ**: không backend
tài khoản, không Firebase/GAS/OAuth, không đọc `Authorization` header của phiên
Google.

> **Bản mới nhất: [`ext/flow-automation-local-1.8.0`](ext/flow-automation-local-1.8.0/)**
> — xem mục "Có gì mới" ở đầu
> [README của bản đó](ext/flow-automation-local-1.8.0/README.md).

---

## Cài đặt (Load unpacked)

Tiện ích **không** phát hành qua Chrome Web Store, nên cài theo kiểu "tải tiện
ích đã giải nén":

1. Tải / clone repo này về máy.
2. Mở Chrome → `chrome://extensions` → bật **Chế độ dành cho nhà phát triển**
   (Developer mode) ở góc trên phải.
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục
   `ext/flow-automation-local-1.8.0` (thư mục **chứa** `manifest.json`, không
   phải chọn chính file đó).
4. Mở `flow.google.com`, bấm icon tiện ích để mở Side Panel.

**Khi cập nhật lên bản mới hơn:** chỉ cần trỏ Load unpacked vào thư mục phiên
bản mới (hoặc `git pull` rồi bấm ⟳ Tải lại trong `chrome://extensions`). Toàn bộ
cài đặt và danh sách dự án đã lưu **không bị mất**, vì chúng nằm trong
`chrome.storage.local` — chỉ mất nếu bạn **gỡ hẳn** tiện ích.

---

## Cấu trúc repo

| Đường dẫn | Nội dung |
|---|---|
| `ext/flow-automation-local-1.8.0/` | **Bản hiện hành** — tự chẩn đoán khi Flow đổi giao diện, tự chọn lại selector |
| `ext/flow-automation-local-1.7.0/` | Bản chạy được **nhiều tab song song** |
| `ext/flow-automation-local-1.6.1/` | Bản fork local đầu tiên (sửa lỗi tên file tiếng Việt) |
| `orig/flow-automation-local-1.5.6/` | Engine **gốc** trước khi fork — giữ để đối chiếu, không dùng để chạy |
| `tests/` | Bộ kiểm thử ba tầng (xem dưới) |
| `shots/` | Ảnh chụp giao diện Side Panel ở chế độ sáng / tối |

Mỗi phiên bản là **một thư mục riêng, giữ song song** — không ghi đè bản cũ. Nhờ
vậy nếu bản mới có lỗi bạn có thể Load unpacked lại bản cũ ngay, không cần chờ vá.

---

## Chạy kiểm thử

```bash
npm install                        # jsdom, cho tầng 1 và 2
npm install -D playwright          # chỉ cần cho tầng 3
npx playwright install chromium    # tải Chromium để test trên browser thật
```

Mọi đường dẫn trong bộ test đều quy chiếu về **gốc repo**, nên clone về đâu cũng
chạy được. Ghi đè khi cần:

| Biến môi trường | Tác dụng |
|---|---|
| `FLOW_VER=1.7.0` | Kiểm thử bản khác trong `ext/` |
| `FLOW_EXT=/đường/dẫn` | Trỏ thẳng vào một thư mục tiện ích bất kỳ |
| `CHROMIUM_PATH=...` | Dùng Chromium khác cho tầng 3 |

Bộ test chia **ba tầng**, mỗi tầng trả lời một loại câu hỏi khác nhau:

```bash
# Tầng 1 — jsdom, chạy vài giây: logic thuần (đặt tên file, parse .txt, hàng đợi…)
node tests/run.js
node tests/integration.js
node tests/diagnostics.js

# Tầng 2 — mô phỏng nhiều tab ở mức logic: bắt race condition
node tests/multitab.js

# Tầng 3 — Chromium THẬT qua Playwright: bắt buộc cho hành vi không đoán được
node tests/multitab-chrome.js
node tests/subfolder-chrome.js
node tests/probe-chrome.js
node tests/screenshot.js
```

**Vì sao phải có tầng 3:** `chrome.downloads.DownloadItem` **không mang
`tabId`** — không có cách nào biết file vừa tải xuống thuộc tab nào. Đây là gốc
rễ của lỗi "hai tab tải cùng lúc thì tên file bị đổi chéo", và nó **chỉ tái hiện
được trên browser thật**; bản mô phỏng ở tầng 2 không đủ tin cậy để kết luận.
Test `multitab-chrome.js` vì thế làm hai việc: tái hiện lỗi khi **không** có
khoá tải (để chứng minh phép thử có ý nghĩa), rồi chứng minh khi **có** khoá thì
hai tab tải song song vẫn nhận đúng tên — tên file đọc thẳng từ
`chrome.downloads` và từ ổ đĩa, không từ mô phỏng.

Quy tắc: thay đổi nào chạm vào `chrome.downloads`, `chrome.storage.session`,
hoặc logic nhiều tab thì **bắt buộc** chạy tầng 3 trước khi coi là xong.

---

## Khi Google Flow đổi giao diện

Tiện ích không dùng API chính thức nào của Google Flow (Google không cung cấp),
nên nó hoạt động bằng cách "đọc" giao diện web — riêng `content-v2.js` có ~175
chỗ tìm phần tử DOM. **Mỗi lần Google đổi giao diện là một số bước có thể
trượt.**

Từ bản 1.8.0 bạn tự vá được trong vài phút, không cần chờ bản cập nhật:

- **Log báo rõ vỡ ở bước nào** (sáu phần tử then chốt được đặt tên tiếng Việt:
  *Ô nhập prompt*, *Nút Tạo*, *Ô tìm kiếm*, *Thẻ video/ảnh*, *Nút ⋮ trên thẻ*,
  *Nút cài đặt mô hình*), kèm banner đỏ và nút **Mở chẩn đoán**.
- **Cài đặt → 🔧 Chẩn đoán giao diện Flow → 🎯 Chọn trên trang**: hover thấy
  viền xanh, click đúng phần tử là xong. Selector bạn chọn được ưu tiên tuyệt
  đối so với cách dò mặc định.
- **⬇ Tải báo cáo .txt**: xuất trạng thái từng phần tử + danh sách ứng viên kèm
  HTML rút gọn + 100 dòng log cuối — gửi đúng file đó là đủ để viết lại selector
  mới, không cần bạn tự mở F12.

Chi tiết trong [README của bản 1.8.0](ext/flow-automation-local-1.8.0/README.md).

---

## Quy ước phát triển

Mã nguồn, comment, giao diện và tài liệu **viết bằng tiếng Việt**. Các quy ước
khác (đặt tên phiên bản, README luôn để mục "Có gì mới" ở đầu, cấu trúc
`UI_TARGETS`, ba tầng kiểm thử) được đóng gói thành một skill của Claude trong
dự án này — xem `.claude/` nếu có, hoặc mục tương ứng trong README từng bản.
