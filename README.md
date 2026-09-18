# Flow Automation Local

Tiện ích Chrome (Manifest V3) tự động hoá thao tác prompt hàng loạt trên
**Google Flow** (`flow.google.com`). Chạy **hoàn toàn cục bộ**: không backend
tài khoản, không Firebase/GAS/OAuth, không đọc `Authorization` header của phiên
Google.

> **Bản mới nhất: [`ext/flow-automation-local-1.10.0`](ext/flow-automation-local-1.10.0/)**
> — sửa lỗi bot đứng vì Chrome báo "mất mạng" sai. Xem mục "Có gì mới" ở đầu
> [README của bản đó](ext/flow-automation-local-1.10.0/README.md).

---

## Cài đặt (Load unpacked)

Tiện ích **không** phát hành qua Chrome Web Store, nên cài theo kiểu "tải tiện
ích đã giải nén":

1. Tải / clone repo này về máy.
2. Mở Chrome → `chrome://extensions` → bật **Chế độ dành cho nhà phát triển**
   (Developer mode) ở góc trên phải.
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục
   `ext/flow-automation-local-1.10.0` (thư mục **chứa** `manifest.json`, không
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
| `ext/flow-automation-local-1.10.0/` | **Bản hiện hành** — không còn đứng vì báo "mất mạng" giả |
| `ext/flow-automation-local-1.9.0/` | Tự báo khi có bản mới |
| `ext/flow-automation-local-1.8.0/` | Tự chẩn đoán khi Flow đổi giao diện, tự chọn lại selector |
| `ext/flow-automation-local-1.7.0/` | Bản chạy được **nhiều tab song song** |
| `ext/flow-automation-local-1.6.1/` | Bản fork local đầu tiên (sửa lỗi tên file tiếng Việt) |
| `orig/flow-automation-local-1.5.6/` | Engine **gốc** trước khi fork — giữ để đối chiếu, không dùng để chạy |
| `version.json` | **File phát hành** — tiện ích đọc file này để biết có bản mới (xem dưới) |
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
node tests/update.js
node tests/network.js


# Tầng 2 — mô phỏng nhiều tab ở mức logic: bắt race condition
node tests/multitab.js

# Tầng 3 — Chromium THẬT qua Playwright: bắt buộc cho hành vi không đoán được
node tests/multitab-chrome.js
node tests/update-chrome.js
node tests/subfolder-chrome.js
node tests/probe-chrome.js
node tests/network-chrome.js
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

`network-chrome.js` (1.10.0) cũng thuộc loại "chỉ browser thật mới chứng minh
được": nó **tái hiện đúng cảnh** `navigator.onLine = false` trong khi request tới
Flow **vẫn thành công** — thứ jsdom không dựng nổi vì `fetch` ở đó là bản giả.

Quy tắc: thay đổi nào chạm vào `chrome.downloads`, `chrome.storage.session`,
logic nhiều tab, hoặc trạng thái mạng thì **bắt buộc** chạy tầng 3 trước khi coi
là xong.

---

## Phát hành một bản mới

Từ bản 1.9.0, tiện ích **tự báo khi có bản mới**: mỗi lần mở Side Panel (và mỗi lần
mở trình duyệt) nó đọc `version.json` ở gốc repo này, so với version trong
`manifest.json` của bản đang chạy, và hiện banner nếu có bản mới hơn.

Nhờ vậy người dùng khác (máy khác, bạn bè) **không cần được nhắn riêng** mới biết —
nhưng họ phải đang chạy **bản 1.9.0 trở lên**, nên bản đầu tiên vẫn phải gửi tay một
lần.

Quy trình phát hành, sửa **một file duy nhất**:

1. Tạo thư mục bản mới `ext/flow-automation-local-X.Y.Z/`, cập nhật `version` trong
   `manifest.json` của nó cho khớp tên thư mục.
2. Sửa `version.json` ở gốc repo:

   ```json
   {
     "version": "X.Y.Z",
     "downloadUrl": "https://github.com/RollReus6868/flow-automation/archive/refs/heads/main.zip",
     "notes": "Một câu ngắn hiện trên banner của người dùng.",
     "publishedAt": "2026-09-20"
   }
   ```

3. `git add -A && git commit -m "X.Y.Z — …" && git push`

Trong vòng vài phút (GitHub cache raw 5 phút) mọi máy sẽ thấy banner. Người nhận tải
`main.zip`, giải nén, rồi Load unpacked thư mục `ext/flow-automation-local-X.Y.Z` bên
trong.

**Lưu ý về repo Private:** `raw.githubusercontent.com` chỉ đọc được không cần token khi
repo **Public**. Nếu chuyển repo sang Private thì tính năng này tắt — khi đó đặt
`version.json` vào một **Gist public** riêng (chỉ chứa số version + link tải, không
chứa code) và đổi địa chỉ trong *Cài đặt → ⬆ Cập nhật tiện ích → Địa chỉ file
version.json*.

**`version.json` phải khớp `manifest.json`** của bản mới nhất — có test tự kiểm
(`tests/update.js`), nên quên cập nhật một trong hai là test đỏ ngay.

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

Chi tiết trong [README của bản hiện hành](ext/flow-automation-local-1.10.0/README.md)
(mục `0c`).

---

## Quy ước phát triển

Mã nguồn, comment, giao diện và tài liệu **viết bằng tiếng Việt**. Các quy ước
khác (đặt tên phiên bản, README luôn để mục "Có gì mới" ở đầu, cấu trúc
`UI_TARGETS`, ba tầng kiểm thử) được đóng gói thành một skill của Claude trong
dự án này — xem `.claude/` nếu có, hoặc mục tương ứng trong README từng bản.
