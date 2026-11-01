package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class CommentsActivity extends AppCompatActivity {
    public static final String EXTRA_STORY_ID = "story_id";
    public static final String EXTRA_CHAPTER_ID = "chapter_id";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient api = new CatalogApiClient();
    private String storyId, chapterId, parentId;
    private boolean busy, deletedParent;
    private int page;
    private TextView status;
    private LinearLayout list;
    private EditText input;
    private AlertDialog editDialog;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_comments);
        SystemBarInsets.apply(findViewById(R.id.comments_root));
        storyId = getIntent().getStringExtra(EXTRA_STORY_ID);
        chapterId = getIntent().getStringExtra(EXTRA_CHAPTER_ID);
        parentId = getIntent().getStringExtra("parent_id");
        deletedParent = getIntent().getBooleanExtra("parent_deleted", false);
        status = findViewById(R.id.comments_status);
        list = findViewById(R.id.comments_list);
        input = findViewById(R.id.comments_input);
        ((TextView) findViewById(R.id.comments_title)).setText(parentId != null ? "Trả lời bình luận" : chapterId != null ? "Bình luận chương" : "Bình luận truyện");
        if (parentId != null) {
            TextView parent = findViewById(R.id.comments_parent);
            parent.setVisibility(View.VISIBLE);
            parent.setText(deletedParent ? "Bình luận gốc đã được xóa." : getIntent().getStringExtra("parent_content"));
            input.setHint("Viết câu trả lời…");
        }
        if (state != null) input.setText(state.getString("draft", ""));
        findViewById(R.id.comments_back).setOnClickListener(view -> finish());
        findViewById(R.id.comments_refresh).setOnClickListener(view -> load(true));
        findViewById(R.id.comments_more).setOnClickListener(view -> load(false));
        findViewById(R.id.comments_send).setOnClickListener(view -> {
            String content = input.getText().toString().trim();
            if (content.isEmpty()) { input.setError("Vui lòng nhập nội dung."); return; }
            mutate(() -> api.addComment(storyId, chapterId, parentId, content), () -> input.setText(""));
        });
        if (storyId == null || storyId.isEmpty()) { status.setText("Không tìm thấy truyện."); setBusy(true); }
    }

    @Override protected void onResume() {
        super.onResume();
        if (storyId != null && !storyId.isEmpty()) load(true);
    }

    private void setBusy(boolean value) {
        busy = value;
        findViewById(R.id.comments_refresh).setEnabled(!value);
        findViewById(R.id.comments_more).setEnabled(!value);
        findViewById(R.id.comments_send).setEnabled(!value && !deletedParent);
        input.setEnabled(!value && !deletedParent);
        enableRows(list, !value);
    }

    private void enableRows(ViewGroup group, boolean enabled) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            child.setEnabled(enabled);
            if (child instanceof ViewGroup) enableRows((ViewGroup) child, enabled);
        }
    }

    private void load(boolean reset) {
        if (busy) return;
        setBusy(true);
        status.setText("Đang tải bình luận…");
        int requestedPage = reset ? 1 : page + 1;
        executor.execute(() -> {
            try {
                JSONObject body = api.getComments(storyId, chapterId, parentId, requestedPage);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (reset) list.removeAllViews();
                    JSONArray comments = body.optJSONArray("comments");
                    if (comments != null) for (int i = 0; i < comments.length(); i++) {
                        JSONObject comment = comments.optJSONObject(i);
                        if (comment != null) addRow(comment);
                    }
                    page = requestedPage;
                    JSONObject pagination = body.optJSONObject("pagination");
                    int total = pagination == null ? 0 : pagination.optInt("total");
                    findViewById(R.id.comments_more).setVisibility(page * 10 < total ? View.VISIBLE : View.GONE);
                    status.setText(total == 0 ? "Chưa có bình luận. Hãy chia sẻ cảm nhận của bạn." : total + " bình luận");
                    setBusy(false);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setBusy(false);
                    status.setText(message(error));
                });
            }
        });
    }

    private TextView text(String value, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(bold ? 15 : 14);
        text.setTextColor(getColor(R.color.readlite_ink));
        text.setPadding(0, 8, 0, 8);
        if (bold) text.setTypeface(text.getTypeface(), android.graphics.Typeface.BOLD);
        return text;
    }

    private void action(LinearLayout row, String label, View.OnClickListener listener) {
        MaterialButton button = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        button.setOnClickListener(listener);
        row.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private void addRow(JSONObject item) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, 16, 0, 16);
        String date = item.optString("updatedAt", "");
        if (date.length() > 10) date = date.substring(0, 10);
        row.addView(text(item.optString("displayName", "Độc giả") + " · " + date, true));
        boolean deleted = item.optBoolean("isDeleted");
        row.addView(text(deleted ? "Bình luận đã được xóa." : item.optString("content"), false));
        String id = item.optString("id");
        if (parentId == null) {
            int replies = item.optInt("replyCount");
            if (!deleted || replies > 0) action(row, replies > 0 ? "Xem " + replies + " câu trả lời" : "Trả lời", view -> {
                Intent thread = new Intent(this, CommentsActivity.class);
                thread.putExtra(EXTRA_STORY_ID, storyId);
                if (chapterId != null) thread.putExtra(EXTRA_CHAPTER_ID, chapterId);
                thread.putExtra("parent_id", id);
                thread.putExtra("parent_content", item.optString("content"));
                thread.putExtra("parent_deleted", deleted);
                startActivity(thread);
            });
        }
        if (!deleted && item.optBoolean("isMine")) {
            action(row, "Sửa", view -> edit(item));
            action(row, "Xóa", view -> new MaterialAlertDialogBuilder(this).setTitle("Xóa bình luận?")
                    .setMessage("Các câu trả lời sẽ được giữ lại.").setNegativeButton("Hủy", null)
                    .setPositiveButton("Xóa", (dialog, which) -> mutate(() -> api.deleteComment(id), () -> { })).show());
        }
        if (!deleted) action(row, "Báo cáo", view -> ReportDialog.show(this, "comment", id));
        View divider = new View(this);
        divider.setBackgroundColor(getColor(R.color.readlite_line));
        row.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        list.addView(row);
    }

    private void edit(JSONObject item) {
        EditText content = new EditText(this);
        content.setText(item.optString("content"));
        content.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        content.setFilters(new InputFilter[]{new InputFilter.LengthFilter(5000)});
        content.setMinLines(3);
        content.setMaxLines(8);
        AlertDialog dialog = new MaterialAlertDialogBuilder(this).setTitle("Sửa bình luận").setView(content)
                .setNegativeButton("Hủy", null).setPositiveButton("Lưu", null).create();
        editDialog = dialog;
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String value = content.getText().toString().trim();
            if (value.isEmpty()) { content.setError("Vui lòng nhập nội dung."); return; }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            mutate(() -> api.editComment(item.optString("id"), value), dialog::dismiss, error -> {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                content.setError(message(error));
            });
        }));
        dialog.show();
    }

    private interface Request { JSONObject execute() throws IOException, JSONException; }
    private void mutate(Request request, Runnable success) { mutate(request, success, error -> { }); }
    private void mutate(Request request, Runnable success, java.util.function.Consumer<Exception> failure) {
        if (busy) return;
        setBusy(true);
        status.setText("Đang lưu…");
        executor.execute(() -> {
            try {
                request.execute();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    success.run();
                    setBusy(false);
                    load(true);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setBusy(false);
                    failure.accept(error);
                    status.setText(message(error));
                });
            }
        });
    }

    private String message(Exception error) {
        return error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Không kết nối được. Nhấn Tải lại để thử lại.";
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("draft", input.getText().toString());
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        if (editDialog != null) editDialog.dismiss();
        executor.shutdownNow();
        super.onDestroy();
    }
}
