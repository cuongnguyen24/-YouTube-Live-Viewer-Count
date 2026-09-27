# YouTube Live Viewer Count

Extension Chrome/Edge nhỏ để hiển thị số người đang xem live ngay trong khung video YouTube.

## Cài đặt trên Chrome hoặc Edge

1. Mở `chrome://extensions` hoặc `edge://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục này: `C:\Users\Admin\Desktop\ToolAXE\ViewLiveYoutube`.
5. Mở lại trang live YouTube.

Khi vào trang live, extension chỉ hiển thị một badge ở góc trên bên phải bên trong khung video.

Badge có nút `↻` để ép cập nhật ngay. Ngoài ra extension cũng tự fetch lại trang live khoảng 1 phút một lần để lấy số người xem mới, nhưng chỉ cập nhật nếu tìm được dữ liệu thuộc video chính.

Badge có nút `×` để ẩn tạm thời trong tab hiện tại. Khi nhấn `F5`, badge sẽ hiện lại.

Khi bấm icon extension trên thanh trình duyệt, bạn có thể cấu hình:

- thời gian tự cập nhật dữ liệu;
- kiểu hiển thị: `1.602 người đang xem`, `1.602`, hoặc `1.602 người`;
- bật/tắt nút cập nhật nhanh `↻` trên badge.

## Ghi chú

YouTube thay đổi giao diện và tên trường dữ liệu khá thường xuyên, nên extension dùng nhiều cách dò cùng lúc:

- đọc text hiển thị trong khu vực video chính bên trái;
- đọc dữ liệu `videoPrimaryInfoRenderer` của video chính;
- gắn badge trong player để không cần thu nhỏ màn hình hoặc kéo xuống dưới video.

Extension tránh lấy số từ danh sách video liên quan bên phải, vì các video đó cũng có dòng `người đang xem`.

Nếu badge chỉ hiện `Đang tìm số người xem...`, hãy thử kéo xuống phần thông tin video một lần để YouTube render dữ liệu, rồi quay lại chế độ xem live.
