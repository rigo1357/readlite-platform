package com.readlite.mobile;

import android.app.AlertDialog;
import android.os.Bundle;
import android.text.InputType;
import android.text.InputFilter;
import android.view.View;
import android.widget.EditText;
import android.widget.CheckBox;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AdminReviewActivity extends AppCompatActivity {
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final StorySubmissionApiClient api = new StorySubmissionApiClient();

    private TextView statusText;
    private TextView titleText;
    private TextView metadataText;
    private TextView warningsText;
    private LinearLayout queue;
    private LinearLayout detail;
    private LinearLayout chapterList;
    private ImageView coverImage;
    private TextView coverPlaceholder;
    private String currentUserId = "";
    private JSONObject currentStory;
    private JSONArray currentChapters;
    private JSONArray queueItems = new JSONArray();
    private final Set<String> selectedIds = new HashSet<>();
    private MaterialButton bulkApproveButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_admin_review);
        SystemBarInsets.apply(findViewById(R.id.admin_review_root));

        statusText = findViewById(R.id.admin_review_status);
        titleText = findViewById(R.id.admin_review_story_title);
        metadataText = findViewById(R.id.admin_review_story_metadata);
        warningsText = findViewById(R.id.admin_review_warnings);
        queue = findViewById(R.id.admin_review_queue);
        detail = findViewById(R.id.admin_review_detail);
        chapterList = findViewById(R.id.admin_review_chapters);
        coverImage = findViewById(R.id.admin_review_cover);
        coverPlaceholder = findViewById(R.id.admin_review_cover_placeholder);
        bulkApproveButton = findViewById(R.id.admin_review_bulk_approve);
        bulkApproveButton.setOnClickListener(view -> confirmBulkApprove());

        findViewById(R.id.admin_review_back).setOnClickListener(view -> showQueue());
        findViewById(R.id.admin_review_approve).setOnClickListener(view -> confirmDecision("approve"));
        findViewById(R.id.admin_review_changes).setOnClickListener(view -> confirmDecision("changes_requested"));
        findViewById(R.id.admin_review_reject).setOnClickListener(view -> confirmDecision("reject"));
        showQueue();
    }

    private void showQueue() {
        currentStory = null;
        selectedIds.clear();
        queue.setVisibility(View.VISIBLE);
        detail.setVisibility(View.GONE);
        bulkApproveButton.setVisibility(View.GONE);
        statusText.setText("Đang tải truyện chờ duyệt…");
        networkExecutor.execute(() -> {
            try {
                JSONObject userResponse = api.currentUser();
                JSONObject user = userResponse.optJSONObject("user");
                String userId = user == null ? "" : user.optString("id", "");
                JSONArray items = api.listAdminQueue().optJSONArray("submissions");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    currentUserId = userId;
                    queueItems = items == null ? new JSONArray() : items;
                    queue.removeAllViews();
                    int count = items == null ? 0 : items.length();
                    for (int index = 0; index < count; index++) {
                        JSONObject item = items.optJSONObject(index);
                        if (item == null) continue;
                        String id = item.optString("id", "");
                        LinearLayout line = new LinearLayout(this);
                        line.setOrientation(LinearLayout.HORIZONTAL);
                        line.setGravity(android.view.Gravity.CENTER_VERTICAL);
                        CheckBox check = new CheckBox(this);
                        check.setContentDescription("Chọn truyện " + item.optString("title", ""));
                        check.setOnCheckedChangeListener((button, checked) -> {
                            if (checked) selectedIds.add(id); else selectedIds.remove(id);
                            bulkApproveButton.setText("Duyệt " + selectedIds.size() + " truyện đã chọn");
                            bulkApproveButton.setEnabled(!selectedIds.isEmpty());
                        });
                        line.addView(check);
                        MaterialButton row = new MaterialButton(this);
                        row.setAllCaps(false);
                        row.setText(item.optString("title", "Truyện chưa có tên") + "\n"
                                + "Người gửi: " + item.optString("submittedByName", "Ẩn danh")
                                + " · AI: " + item.optString("aiReviewStatus", ""));
                        row.setOnClickListener(view -> openSubmission(id));
                        line.addView(row, new LinearLayout.LayoutParams(0,
                                LinearLayout.LayoutParams.WRAP_CONTENT, 1));
                        queue.addView(line);
                    }
                    bulkApproveButton.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
                    bulkApproveButton.setEnabled(false);
                    statusText.setText(count == 0
                            ? "Chưa có truyện nào chờ duyệt."
                            : "Có " + count + " truyện chờ bạn xem xét.");
                });
            } catch (IOException | JSONException exception) {
                showError(exception);
            }
        });
    }

    private void confirmBulkApprove() {
        if (selectedIds.isEmpty()) return;
        int warnings = 0;
        for (int index = 0; index < queueItems.length(); index++) {
            JSONObject item = queueItems.optJSONObject(index);
            if (item != null && selectedIds.contains(item.optString("id"))
                    && "warnings".equals(item.optString("aiReviewStatus"))) warnings++;
        }
        String message = "Duyệt và xuất bản " + selectedIds.size() + " truyện? Hãy mở từng truyện để kiểm tra nội dung trước.";
        if (warnings > 0) message += " Có " + warnings + " truyện có cảnh báo AI.";
        new AlertDialog.Builder(this).setTitle("Duyệt nhiều truyện").setMessage(message)
                .setPositiveButton("Duyệt", (dialog, which) -> bulkApprove())
                .setNegativeButton(android.R.string.cancel, null).show();
    }

    private void bulkApprove() {
        ArrayList<String> ids = new ArrayList<>(selectedIds);
        bulkApproveButton.setEnabled(false);
        networkExecutor.execute(() -> {
            int success = 0;
            ArrayList<String> failures = new ArrayList<>();
            for (String id : ids) {
                try { api.decide(id, "approve", ""); success++; }
                catch (IOException | JSONException exception) { failures.add(id + ": " + exception.getMessage()); }
            }
            final int approved = success;
            final String summary = "Đã duyệt " + approved + "/" + ids.size() + " truyện."
                    + (failures.isEmpty() ? "" : " Lỗi: " + android.text.TextUtils.join("; ", failures));
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                showQueue();
                android.widget.Toast.makeText(this, summary, android.widget.Toast.LENGTH_LONG).show();
            });
        });
    }

    private void openSubmission(String storyId) {
        queue.setVisibility(View.GONE);
        bulkApproveButton.setVisibility(View.GONE);
        detail.setVisibility(View.VISIBLE);
        statusText.setText("Đang tải nội dung cần duyệt…");
        networkExecutor.execute(() -> {
            try {
                JSONObject response = api.getAdminStory(storyId);
                JSONObject story = response.optJSONObject("story");
                JSONArray chapters = response.optJSONArray("chapters");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || story == null) return;
                    currentStory = story;
                    currentChapters = chapters == null ? new JSONArray() : chapters;
                    renderDetail(story, currentChapters);
                });
            } catch (IOException | JSONException exception) {
                showError(exception);
            }
        });
    }

    private void renderDetail(JSONObject story, JSONArray chapters) {
        String title = story.optString("title", "");
        titleText.setText(title);
        StoryCoverLoader.bind(story.optString("coverUrl", ""), title,
                coverImage, coverPlaceholder, 128, 184);
        metadataText.setText("Tác giả: " + story.optString("author", "")
                + "\nNgười gửi: " + story.optString("submittedByName", "")
                + "\nNgôn ngữ: " + story.optString("language", "")
                + "\n\n" + story.optString("summary", ""));
        String aiStatus = story.optString("aiReviewStatus", "");
        JSONArray warnings = story.optJSONArray("aiReviewWarnings");
        StringBuilder warningText = new StringBuilder("Kết quả AI: ").append(aiStatus);
        if (warnings != null && warnings.length() > 0) {
            warningText.append("\nCảnh báo cần xem xét:");
            for (int index = 0; index < warnings.length(); index++) {
                Object warning = warnings.opt(index);
                warningText.append("\n• ").append(warning instanceof JSONObject
                        ? ((JSONObject) warning).optString("message", warning.toString())
                        : String.valueOf(warning));
            }
        } else {
            warningText.append("skipped".equals(aiStatus) ? "\nChưa rà soát AI. Cần quản trị viên kiểm tra thủ công." : "\nAI không ghi nhận cảnh báo.");
        }
        warningsText.setText(warningText);
        chapterList.removeAllViews();
        String activeVolume = "";
        for (int index = 0; index < chapters.length(); index++) {
            JSONObject chapter = chapters.optJSONObject(index);
            if (chapter == null) continue;
            String volume = chapter.optString("volumeTitle", "");
            if (!volume.equals(activeVolume)) {
                activeVolume = volume;
                TextView heading = new TextView(this);
                heading.setText(volume.isEmpty() ? "Chưa phân tập" : volume);
                heading.setTextColor(getColor(R.color.readlite_green));
                heading.setTextSize(17);
                heading.setTypeface(heading.getTypeface(), android.graphics.Typeface.BOLD);
                heading.setPadding(0, 12, 0, 4);
                chapterList.addView(heading);
            }
            MaterialButton row = new MaterialButton(this);
            row.setAllCaps(false);
            row.setText(getString(R.string.chapter_row,
                    chapter.optInt("chapterOrder", index + 1), chapter.optString("title", "")));
            row.setOnClickListener(view -> showChapter(chapter));
            chapterList.addView(row);
        }

        boolean selfSubmission = !currentUserId.isEmpty()
                && currentUserId.equals(story.optString("submittedBy", ""));
        findViewById(R.id.admin_review_approve).setEnabled(true);
        findViewById(R.id.admin_review_changes).setEnabled(true);
        findViewById(R.id.admin_review_reject).setEnabled(true);
        statusText.setText("Đọc nội dung trước khi duyệt xuất bản. AI có thể chưa được cấu hình.");
    }

    private void showChapter(JSONObject chapter) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(18, 14, 18, 14);
        TextView chapterTitle = new TextView(this);
        chapterTitle.setText(chapter.optString("title", ""));
        chapterTitle.setTextSize(20);
        chapterTitle.setTextColor(getColor(R.color.readlite_ink));
        chapterTitle.setTypeface(chapterTitle.getTypeface(), android.graphics.Typeface.BOLD);
        content.addView(chapterTitle);
        new ReaderBlockAdapter(this, content, ReaderPreferences.getFontSize(this))
                .render(chapter.optJSONArray("blocks"), chapter.optString("content", ""));
        scroll.addView(content);
        new AlertDialog.Builder(this)
                .setTitle(chapter.optString("title", "Xem chương"))
                .setView(scroll)
                .setPositiveButton(android.R.string.ok, null)
                .show();
    }

    private void confirmDecision(String decision) {
        if (currentStory == null || currentStory.optString("id", "").isEmpty()) return;
        EditText reason = new EditText(this);
        reason.setHint("Lý do, bắt buộc khi yêu cầu sửa hoặc từ chối");
        reason.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        reason.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2000)});
        boolean hasWarnings = "warnings".equals(currentStory.optString("aiReviewStatus", ""));
        String message = "approve".equals(decision) && hasWarnings
                ? "AI đã gắn cảnh báo. Bạn đã xem xét và vẫn muốn xuất bản truyện này?"
                : "Xác nhận quyết định kiểm duyệt?";
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
                .setTitle("Xác nhận duyệt truyện")
                .setMessage(message)
                .setPositiveButton("Xác nhận", (ignored, which) -> {
                    String value = reason.getText().toString().trim();
                    if (!"approve".equals(decision) && value.isEmpty()) {
                        statusText.setText("Cần nhập lý do khi yêu cầu chỉnh sửa hoặc từ chối.");
                        return;
                    }
                    makeDecision(decision, value);
                })
                .setNegativeButton(android.R.string.cancel, null);
        if (!"approve".equals(decision)) dialog.setView(reason);
        dialog.show();
    }

    private void makeDecision(String decision, String reason) {
        String storyId = currentStory.optString("id", "");
        statusText.setText("Đang lưu quyết định…");
        findViewById(R.id.admin_review_approve).setEnabled(false);
        findViewById(R.id.admin_review_changes).setEnabled(false);
        findViewById(R.id.admin_review_reject).setEnabled(false);
        networkExecutor.execute(() -> {
            try {
                api.decide(storyId, decision, reason);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    statusText.setText("Đã lưu quyết định kiểm duyệt.");
                    showQueue();
                });
            } catch (IOException | JSONException exception) {
                showError(exception);
            }
        });
    }

    private void showError(Exception exception) {
        runOnUiThread(() -> {
            if (!isFinishing() && !isDestroyed()) {
                if (currentStory != null) {
                    boolean selfSubmission = !currentUserId.isEmpty()
                            && currentUserId.equals(currentStory.optString("submittedBy", ""));
                    findViewById(R.id.admin_review_approve).setEnabled(true);
                    findViewById(R.id.admin_review_changes).setEnabled(true);
                    findViewById(R.id.admin_review_reject).setEnabled(true);
                }
                statusText.setText(exception instanceof CatalogApiClient.ApiException
                        ? exception.getMessage()
                        : "Không kết nối được ReadLite API. Hãy thử lại.");
            }
        });
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
