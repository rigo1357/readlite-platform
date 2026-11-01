package com.readlite.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Pending additions are separate from published chapters; administrative review takes place on the web. */
public final class ContentUpdatesActivity extends AppCompatActivity {
    private static final int PICK_UPDATE = 4201;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final StorySubmissionApiClient api = new StorySubmissionApiClient();
    private LinearLayout body;
    private TextView status;
    private String storyId;
    private String updateId;
    private boolean busy;
    private int page = 1;
    private JSONArray volumes = new JSONArray();
    private boolean published;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_content_updates);
        SystemBarInsets.apply(findViewById(R.id.content_updates_root));
        body = findViewById(R.id.content_updates_body);
        status = findViewById(R.id.content_updates_status);
        storyId = getIntent().getStringExtra("story_id");
        if (storyId == null || !storyId.matches("[1-9][0-9]{0,18}")) { finish(); return; }
        updateId = state == null ? null : state.getString("update_id");
        page = state == null ? 1 : state.getInt("page", 1);
        findViewById(R.id.content_updates_back).setOnClickListener(view -> onBackPressed());
        if (updateId == null) loadList(); else loadDetail(updateId);
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putString("update_id", updateId); out.putInt("page", page); }
    private void controls(ViewGroup group, boolean enabled) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i); child.setEnabled(enabled);
            if (child instanceof ViewGroup) controls((ViewGroup) child, enabled);
        }
    }
    private void setBusy(boolean value) { busy = value; controls(body, !value); }
    private void loadList() {
        if (busy) return;
        updateId = null; body.removeAllViews(); setBusy(true); status.setText("Đang tải các bản bổ sung…");
        executor.execute(() -> {
            try {
                JSONObject storyResponse = api.getAuthorStory(storyId);
                JSONObject story = storyResponse.getJSONObject("story");
                JSONArray fetchedVolumes = storyResponse.getJSONObject("preview").optJSONArray("volumes");
                JSONObject result = api.listContentUpdates(storyId, page);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    volumes = fetchedVolumes == null ? new JSONArray() : fetchedVolumes;
                    published = "published".equals(story.optString("moderationStatus")) && "ongoing".equals(story.optString("lifecycleStatus", "ongoing"));
                    if (!"ongoing".equals(story.optString("lifecycleStatus", "ongoing"))) text(body, "Muốn thêm chương, hãy chuyển truyện về Đang ra trên web quản lý.", 14);
                    body.removeAllViews(); text(body, story.optString("title"), 22);
                    text(body, "Nội dung mới được lưu riêng và chỉ hiện trên app khi quản trị viên duyệt. Chương cũ và tiến độ đọc được giữ lại.", 14);
                    if (published) {
                        button(body, "+ Nhập chương bằng tay", () -> manualDialog(null));
                        button(body, "+ Nhập phần tiếp theo từ EPUB", this::pickEpub);
                    }
                    button(body, "Tải lại", this::loadList);
                    JSONArray items = result.optJSONArray("updates");
                    if (items != null) for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.optJSONObject(i); if (item == null) continue;
                        button(body, item.optString("title") + "\n" + label(item.optString("status")) + " · " + item.optInt("chapterCount") + " chương", () -> loadDetail(item.optString("id")));
                    }
                    JSONObject pagination = result.optJSONObject("pagination");
                    int total = pagination == null ? 0 : pagination.optInt("total");
                    if (page > 1) button(body, "Trang trước", () -> { page--; loadList(); });
                    if (page * 20 < total) button(body, "Trang sau", () -> { page++; loadList(); });
                    status.setText(total + " bản bổ sung · Trang " + page);
                    setBusy(false);
                });
            } catch (IOException | JSONException error) { failure(error); }
        });
    }
    private void loadDetail(String id) {
        if (busy) return;
        updateId = id; body.removeAllViews(); setBusy(true); status.setText("Đang tải bản bổ sung…");
        executor.execute(() -> {
            try {
                JSONObject storyResponse = api.getAuthorStory(storyId);
                JSONArray fetchedVolumes = storyResponse.getJSONObject("preview").optJSONArray("volumes");
                JSONObject result = api.getContentUpdate(id);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    volumes = fetchedVolumes == null ? new JSONArray() : fetchedVolumes;
                    updateId = id; renderDetail(result); setBusy(false);
                });
            } catch (IOException | JSONException error) { failure(error); }
        });
    }
    private void renderDetail(JSONObject detail) {
        JSONObject update = detail.optJSONObject("update"); if (update == null) return;
        body.removeAllViews();
        text(body, update.optString("title"), 22);
        text(body, update.optString("storyTitle"), 14);
        String state = update.optString("status");
        status.setText(label(state));
        String reason = update.optString("reviewReason", "");
        if (!update.isNull("reviewReason") && !reason.isEmpty()) text(body, "Lý do kiểm duyệt: " + reason, 14);
        JSONArray warnings = update.optJSONArray("warnings");
        if (warnings != null) for (int i = 0; i < warnings.length(); i++) text(body, "• " + warnings.optString(i), 13);
        boolean editable = "draft".equals(state) || "changes_requested".equals(state);
        if (editable) {
            if ("manual".equals(update.optString("source"))) button(body, "Chỉnh sửa bản bổ sung", () -> manualDialog(detail));
            else text(body, "Có thể chỉnh tên và thứ tự mục lục EPUB trên web quản trị trước khi gửi duyệt.", 13);
            button(body, "Gửi duyệt chương mới", () -> confirmAction(false));
        }
        if (editable || "pending".equals(state)) button(body, "Hủy bản bổ sung", () -> confirmAction(true));
        button(body, "Tải lại trạng thái", () -> loadDetail(updateId));
        JSONArray chapters = detail.optJSONArray("chapters");
        text(body, "Nội dung xem trước · " + (chapters == null ? 0 : chapters.length()) + " chương", 17);
        if (chapters != null) showChapters(chapters, 0);
    }
    private void showChapters(JSONArray chapters, int start) {
        int end = Math.min(start + 20, chapters.length());
        for (int i = start; i < end; i++) {
            JSONObject chapter = chapters.optJSONObject(i); if (chapter == null) continue;
            LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setVisibility(View.GONE);
            button(body, chapter.optString("volumeTitle") + " · " + chapter.optString("title"), () -> {
                if (content.getChildCount() == 0) new ReaderBlockAdapter(this, content, ReaderPreferences.getFontSize(this)).render(chapter.optJSONArray("blocks"), chapter.optString("content"));
                content.setVisibility(content.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
            });
            body.addView(content);
        }
        if (end < chapters.length()) {
            MaterialButton more = button(body, "Xem thêm chương", null);
            more.setOnClickListener(view -> { body.removeView(more); showChapters(chapters, end); });
        }
    }
    private void confirmAction(boolean cancel) {
        new AlertDialog.Builder(this).setTitle(cancel ? "Hủy bản bổ sung?" : "Gửi duyệt chương mới?")
                .setMessage(cancel ? "Các chương đã xuất bản vẫn được giữ nguyên." : "Quản trị viên sẽ kiểm tra trước khi đưa các chương này lên app.")
                .setNegativeButton("Để sau", null).setPositiveButton("Xác nhận", (dialog, which) -> {
                    if (busy) return;
                    String id = updateId; setBusy(true); status.setText("Đang lưu…");
                    executor.execute(() -> {
                        try { api.submitContentUpdate(id, cancel); runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; setBusy(false); loadDetail(id); }); }
                        catch (IOException | JSONException error) { failure(error); }
                    });
                }).show();
    }
    private void pickEpub() {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/epub+zip", "application/octet-stream"});
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(picker, PICK_UPDATE);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_UPDATE || result != Activity.RESULT_OK || data == null || data.getData() == null || busy) return;
        Uri uri = data.getData();
        new AlertDialog.Builder(this).setTitle("Nhập EPUB bổ sung")
                .setMessage("Chọn EPUB chỉ chứa phần mới để tránh trùng chương. Mỗi tập sẽ nối ở cuối truyện; bìa và thông tin truyện hiện tại vẫn giữ nguyên. Tệp tối đa 100 MiB.")
                .setNegativeButton("Hủy", null).setPositiveButton("Nhập bản nháp", (dialog, which) -> {
                    setBusy(true); status.setText("Đang tải và đọc EPUB…");
                    executor.execute(() -> {
                        try {
                            JSONObject created = api.importContentUpdate(this, uri, storyId, null);
                            runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; setBusy(false); loadDetail(created.optString("updateId")); });
                        } catch (IOException | JSONException error) { failure(error); }
                    });
                }).show();
    }
    private void manualDialog(JSONObject detail) {
        if (busy) return;
        JSONObject update = detail == null ? null : detail.optJSONObject("update");
        JSONArray originals = detail == null ? null : detail.optJSONArray("chapters");
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(18), dp(8), dp(18), dp(16)); scroll.addView(form);
        EditText name = input(form, "Tên bản bổ sung", update == null ? "Chương mới" : update.optString("title"), false, 500);
        EditText volumeName = input(form, "Tên tập mới", originals == null || originals.length() == 0 ? "Phần tiếp theo" : originals.optJSONObject(0).optString("volumeTitle"), false, 500);
        text(form, "Nối chương vào tập cuối hoặc tạo tập mới. Chương cũ không bị thay thế.", 13);
        Spinner target = new Spinner(this);
        ArrayList<String> targetIds = new ArrayList<>(); ArrayList<String> options = new ArrayList<>();
        targetIds.add(""); options.add("Tạo tập mới ở cuối truyện");
        String selected = update == null || update.isNull("targetVolumeId") ? "" : update.optString("targetVolumeId");
        JSONObject last = volumes.length() == 0 ? null : volumes.optJSONObject(volumes.length() - 1);
        if (last != null) { targetIds.add(last.optString("id")); options.add(last.optString("title") + " (tập cuối)"); }
        if (!targetIds.contains(selected)) { targetIds.add(selected); options.add("Tập cũ — cần chọn lại tập cuối"); }
        target.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, options));
        target.setSelection(targetIds.indexOf(selected)); form.addView(target);
        LinearLayout chapters = new LinearLayout(this); chapters.setOrientation(LinearLayout.VERTICAL); form.addView(chapters);
        ArrayList<EditText[]> fields = new ArrayList<>();
        if (originals != null) for (int i = 0; i < originals.length(); i++) addChapterFields(chapters, fields, originals.optJSONObject(i));
        if (fields.isEmpty()) addChapterFields(chapters, fields, null);
        MaterialButton add = button(form, "+ Thêm chương", () -> { if (fields.size() < 100) addChapterFields(chapters, fields, null); });
        TextView errorText = text(form, "", 13);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Bản nháp chương bổ sung").setView(scroll).setNegativeButton("Đóng", null).setPositiveButton("Lưu bản nháp", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                JSONArray chapterData = new JSONArray();
                if (fields.isEmpty()) { errorText.setText("Cần ít nhất một chương."); return; }
                if (name.getText().toString().trim().isEmpty() || volumeName.getText().toString().trim().isEmpty()) { errorText.setText("Nhập tên bản bổ sung và tên tập."); return; }
                for (EditText[] pair : fields) {
                    String title = pair[0].getText().toString().trim(); String content = pair[1].getText().toString().trim();
                    if (title.isEmpty() || content.isEmpty()) { errorText.setText("Tên và nội dung mỗi chương không được trống."); return; }
                    chapterData.put(new JSONObject().put("title", title).put("content", content));
                }
                String volumeId = targetIds.get(target.getSelectedItemPosition());
                JSONObject payload = new JSONObject().put("title", name.getText().toString().trim()).put("volumeTitle", volumeName.getText().toString().trim())
                        .put("targetVolumeId", volumeId.isEmpty() ? JSONObject.NULL : volumeId).put("chapters", chapterData);
                dialog.setCancelable(false); dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false); add.setEnabled(false); controls(form, false); setBusy(true);
                errorText.setText("Đang lưu bản nháp…");
                executor.execute(() -> {
                    try {
                        JSONObject result = update == null ? api.createContentUpdate(storyId, payload) : api.saveContentUpdate(update.optString("id"), payload);
                        String id = result.optString("updateId");
                        runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; setBusy(false); dialog.dismiss(); loadDetail(id); });
                    } catch (IOException | JSONException error) {
                        runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; setBusy(false); dialog.setCancelable(true); dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); controls(form, true); errorText.setText(error.getMessage()); });
                    }
                });
            } catch (JSONException error) { errorText.setText("Không thể chuẩn bị nội dung. Hãy thử lại."); }
        }));
        dialog.show();
    }
    private void addChapterFields(LinearLayout parent, ArrayList<EditText[]> fields, JSONObject chapter) {
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); parent.addView(card);
        text(card, "Chương bổ sung", 16);
        EditText title = input(card, "Tên chương", chapter == null ? "" : chapter.optString("title"), false, 500);
        EditText content = input(card, "Nội dung chương", chapter == null ? "" : chapter.optString("content"), true, 500000);
        EditText[] pair = new EditText[]{title, content}; fields.add(pair);
        button(card, "Bỏ chương này", () -> { if (fields.size() > 1) { fields.remove(pair); parent.removeView(card); } });
    }
    private EditText input(LinearLayout parent, String hint, String value, boolean multiline, int limit) {
        text(parent, hint, 13);
        EditText field = new EditText(this); field.setHint(hint); field.setText(value); field.setTextColor(ContextCompat.getColor(this, R.color.readlite_ink));
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | (multiline ? InputType.TYPE_TEXT_FLAG_MULTI_LINE : 0));
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(limit)}); if (multiline) field.setMinLines(5);
        parent.addView(field, new LinearLayout.LayoutParams(-1, -2)); return field;
    }
    private MaterialButton button(LinearLayout parent, String title, Runnable action) {
        MaterialButton button = new MaterialButton(this); button.setText(title); button.setAllCaps(false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(8); parent.addView(button, params);
        if (action != null) button.setOnClickListener(view -> { if (!busy) action.run(); }); return button;
    }
    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(ContextCompat.getColor(this, R.color.readlite_ink));
        view.setPadding(0, dp(8), 0, dp(8)); parent.addView(view); return view;
    }
    private String label(String value) {
        switch (value) { case "pending": return "Chờ quản trị viên duyệt"; case "published": return "Đã xuất bản"; case "changes_requested": return "Cần chỉnh sửa"; case "rejected": return "Đã từ chối"; case "cancelled": return "Đã hủy"; default: return "Bản nháp"; }
    }
    private void failure(Exception error) { runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; setBusy(false); status.setText(error.getMessage() == null ? "Không thể kết nối máy chủ. Hãy thử lại." : error.getMessage()); if (body.getChildCount() == 0) button(body, "Thử lại", () -> { if (updateId == null) loadList(); else loadDetail(updateId); }); }); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onBackPressed() { if (busy) return; if (updateId != null) { updateId = null; loadList(); } else super.onBackPressed(); }
    @Override protected void onDestroy() { api.cancelActiveUpload(); executor.shutdownNow(); super.onDestroy(); }
}
