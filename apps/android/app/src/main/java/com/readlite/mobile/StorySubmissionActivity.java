package com.readlite.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.EditText;
import android.widget.CheckBox;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class StorySubmissionActivity extends AppCompatActivity {
    private static final int PICK_EPUB = 4101;
    private static final int PICK_COVER = 4102;

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final StorySubmissionApiClient api = new StorySubmissionApiClient();

    private TextView statusText;
    private TextView previewSummary;
    private TextView warningsText;
    private LinearLayout listPanel;
    private LinearLayout storyList;
    private LinearLayout editor;
    private LinearLayout preview;
    private ProgressBar uploadProgress;
    private MaterialButton cancelButton;
    private MaterialButton saveButton;
    private MaterialButton submitButton;
    private EditText titleInput;
    private EditText authorInput;
    private EditText languageInput;
    private EditText summaryInput;
    private ImageView coverImage;
    private TextView coverPlaceholder;
    private String storyId;
    private String coverUrl;
    private JSONArray importWarnings;
    private Future<?> activeUpload;
    private final Set<String> selectedDraftIds = new HashSet<>();
    private MaterialButton batchSubmitButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_story_submission);
        SystemBarInsets.apply(findViewById(R.id.story_submission_root));

        statusText = findViewById(R.id.story_submission_status);
        previewSummary = findViewById(R.id.story_submission_preview_summary);
        warningsText = findViewById(R.id.story_submission_warnings);
        listPanel = findViewById(R.id.story_submission_list_panel);
        storyList = findViewById(R.id.story_submission_list);
        editor = findViewById(R.id.story_submission_editor);
        preview = findViewById(R.id.story_submission_preview);
        uploadProgress = findViewById(R.id.story_submission_progress);
        cancelButton = findViewById(R.id.story_submission_cancel_upload);
        batchSubmitButton = findViewById(R.id.story_submission_batch_submit);
        batchSubmitButton.setOnClickListener(view -> confirmBatchSubmit());
        saveButton = findViewById(R.id.story_submission_save_button);
        submitButton = findViewById(R.id.story_submission_send_button);
        titleInput = findViewById(R.id.story_submission_title);
        authorInput = findViewById(R.id.story_submission_author);
        languageInput = findViewById(R.id.story_submission_language);
        summaryInput = findViewById(R.id.story_submission_summary);
        coverImage = findViewById(R.id.story_submission_cover);
        coverPlaceholder = findViewById(R.id.story_submission_cover_placeholder);

        findViewById(R.id.story_submission_back).setOnClickListener(view -> onBackPressed());
        findViewById(R.id.story_submission_import_button).setOnClickListener(view -> pickEpub());
        findViewById(R.id.story_submission_cover_button).setOnClickListener(view -> pickCover());
        saveButton.setOnClickListener(view -> saveMetadata());
        submitButton.setOnClickListener(view -> submitForReview());
        cancelButton.setOnClickListener(view -> cancelUpload());

        showList();
    }

    private void showList() {
        storyId = null;
        coverUrl = null;
        selectedDraftIds.clear();
        batchSubmitButton.setVisibility(View.GONE);
        listPanel.setVisibility(View.VISIBLE);
        editor.setVisibility(View.GONE);
        statusText.setText("Đang tải danh sách truyện…");
        networkExecutor.execute(() -> {
            try {
                JSONArray stories = api.listMyStories("all").optJSONArray("stories");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    storyList.removeAllViews();
                    int count = stories == null ? 0 : stories.length();
                    for (int index = 0; index < count; index++) {
                        JSONObject item = stories.optJSONObject(index);
                        if (item == null) continue;
                        String id = item.optString("id", "");
                        String title = item.optString("title", "Truyện chưa có tên");
                        String state = item.optString("moderationStatus", "draft");
                        MaterialCardView row = new MaterialCardView(this);
                        row.setCardBackgroundColor(ContextCompat.getColor(this, R.color.readlite_surface));
                        row.setStrokeColor(ContextCompat.getColor(this, R.color.readlite_line));
                        row.setStrokeWidth(dp(1));
                        row.setRadius(dp(14));
                        row.setCardElevation(0);
                        row.setClickable(true);
                        row.setFocusable(true);
                        LinearLayout content = new LinearLayout(this);
                        content.setOrientation(LinearLayout.VERTICAL);
                        content.setPadding(dp(16), dp(14), dp(16), dp(14));
                        if ("draft".equals(state) || "changes_requested".equals(state)) {
                            CheckBox check = new CheckBox(this);
                            check.setText("Chọn để gửi duyệt");
                            check.setTextColor(ContextCompat.getColor(this, R.color.readlite_muted));
                            check.setOnCheckedChangeListener((button, checked) -> {
                                if (checked) selectedDraftIds.add(id); else selectedDraftIds.remove(id);
                                batchSubmitButton.setText("Gửi duyệt " + selectedDraftIds.size() + " bản nháp");
                                batchSubmitButton.setEnabled(!selectedDraftIds.isEmpty());
                            });
                            content.addView(check);
                        }
                        TextView titleView = new TextView(this);
                        titleView.setText(title);
                        titleView.setTextColor(ContextCompat.getColor(this, R.color.readlite_ink));
                        titleView.setTextSize(16);
                        titleView.setTypeface(null, android.graphics.Typeface.BOLD);
                        titleView.setMaxLines(2);
                        titleView.setEllipsize(TextUtils.TruncateAt.END);
                        content.addView(titleView);
                        TextView detailView = new TextView(this);
                        detailView.setText(statusLabel(state) + " · " + item.optInt("totalChapters", 0) + " chương");
                        detailView.setTextColor(ContextCompat.getColor(this, R.color.readlite_muted));
                        detailView.setTextSize(13);
                        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                        detailParams.topMargin = dp(6);
                        content.addView(detailView, detailParams);
                        row.addView(content);
                        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                        rowParams.bottomMargin = dp(10);
                        row.setOnClickListener(view -> openStory(id));
                        storyList.addView(row, rowParams);
                    }
                    statusText.setText(count == 0
                            ? "Chưa có truyện. Hãy tạo bản nháp từ tệp EPUB của bạn."
                            : "Có " + count + " truyện trong danh sách của bạn.");
                    batchSubmitButton.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
                    batchSubmitButton.setEnabled(false);
                });
            } catch (IOException | JSONException exception) {
                showError(exception);
            }
        });
    }

    private void confirmBatchSubmit() {
        if (selectedDraftIds.isEmpty()) return;
        new AlertDialog.Builder(this)
                .setTitle("Gửi nhiều bản nháp")
                .setMessage("Gửi " + selectedDraftIds.size() + " truyện để kiểm duyệt? Hãy xem lại thông tin và bìa trước khi gửi.")
                .setPositiveButton("Gửi duyệt", (dialog, which) -> batchSubmit())
                .setNegativeButton(android.R.string.cancel, null).show();
    }

    private void batchSubmit() {
        ArrayList<String> ids = new ArrayList<>(selectedDraftIds);
        batchSubmitButton.setEnabled(false);
        networkExecutor.execute(() -> {
            int success = 0;
            ArrayList<String> failures = new ArrayList<>();
            for (String id : ids) {
                try { api.submitStory(id); success++; }
                catch (IOException | JSONException exception) { failures.add(id + ": " + errorMessage(exception)); }
            }
            final String summary = "Đã gửi " + success + "/" + ids.size() + " bản nháp."
                    + (failures.isEmpty() ? "" : " Lỗi: " + TextUtils.join("; ", failures));
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                showList();
                android.widget.Toast.makeText(this, summary, android.widget.Toast.LENGTH_LONG).show();
            });
        });
    }

    private void pickEpub() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/epub+zip", "application/x-epub+zip", "application/octet-stream"
        });
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_EPUB);
    }

    private void pickCover() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_COVER);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != Activity.RESULT_OK || data == null) return;
        if (requestCode == PICK_EPUB) {
            ArrayList<Uri> selectedFiles = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int index = 0; index < clip.getItemCount(); index++) {
                    Uri uri = clip.getItemAt(index).getUri();
                    if (uri != null && !selectedFiles.contains(uri)) selectedFiles.add(uri);
                }
            } else if (data.getData() != null) selectedFiles.add(data.getData());
            if (selectedFiles.isEmpty()) return;
            if (selectedFiles.size() > 20) {
                statusText.setText("Mỗi lượt nhập tối đa 20 tệp EPUB.");
                return;
            }
            for (Uri uri : selectedFiles) {
                try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                catch (SecurityException ignored) { /* Temporary access is enough for this upload. */ }
            }
            if (selectedFiles.size() == 1) uploadEpub(selectedFiles.get(0));
            else uploadEpubBatch(selectedFiles);
            return;
        }
        if (data.getData() == null) return;
        Uri selected = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(selected, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Some document providers grant a temporary read permission only.
        }
        if (requestCode == PICK_COVER) {
            uploadCover(selected);
        }
    }

    private void uploadEpubBatch(ArrayList<Uri> files) {
        statusText.setText("Đang nhập " + files.size() + " tệp EPUB…");
        startUploadProgress();
        findViewById(R.id.story_submission_import_button).setEnabled(false);
        activeUpload = networkExecutor.submit(() -> {
            int success = 0;
            ArrayList<String> failures = new ArrayList<>();
            for (int index = 0; index < files.size(); index++) {
                if (Thread.currentThread().isInterrupted()) break;
                final int fileNumber = index + 1;
                runOnUiThread(() -> statusText.setText("Đang nhập tệp " + fileNumber + "/" + files.size() + "…"));
                try {
                    api.importEpub(this, files.get(index), (sent, total) -> runOnUiThread(() -> {
                        if (total > 0 && !isFinishing() && !isDestroyed()) {
                            uploadProgress.setIndeterminate(false);
                            uploadProgress.setProgress((int) Math.min(100, sent * 100 / total));
                        }
                    }));
                    success++;
                } catch (IOException | JSONException exception) {
                    if (Thread.currentThread().isInterrupted()) break;
                    failures.add("Tệp " + fileNumber + ": " + errorMessage(exception));
                }
            }
            final int imported = success;
            final String errorSummary = failures.isEmpty() ? "" : "\n" + TextUtils.join("\n", failures);
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                finishUploadProgress();
                findViewById(R.id.story_submission_import_button).setEnabled(true);
                showList();
                android.widget.Toast.makeText(this,
                        "Đã nhập " + imported + "/" + files.size() + " bản nháp." + errorSummary,
                        android.widget.Toast.LENGTH_LONG).show();
            });
        });
    }

    private void uploadEpub(Uri uri) {
        showEditor();
        setEditorActionsEnabled(false);
        statusText.setText("Đang tải EPUB và tạo bản nháp riêng…");
        startUploadProgress();
        activeUpload = networkExecutor.submit(() -> {
            try {
                JSONObject result = api.importEpub(this, uri, this::updateUploadProgress);
                JSONObject importedStory = result.optJSONObject("story");
                String importedId = importedStory == null ? "" : importedStory.optString("id", "");
                if (importedId.isEmpty()) throw new IOException("Máy chủ không trả mã bản nháp.");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    storyId = importedId;
                    importWarnings = result.optJSONArray("warnings");
                    finishUploadProgress();
                    statusText.setText("Đã tải EPUB lên và lưu thành bản nháp trên máy chủ. Đang tải lại phần xem trước…");
                    loadStory(importedId);
                });
            } catch (IOException | JSONException exception) {
                finishUploadWithError(exception);
            }
        });
    }

    private void uploadCover(Uri uri) {
        if (storyId == null) {
            statusText.setText("Hãy tạo bản nháp EPUB trước khi thêm ảnh bìa.");
            return;
        }
        setEditorActionsEnabled(false);
        statusText.setText("Đang tải ảnh bìa…");
        startUploadProgress();
        String currentId = storyId;
        activeUpload = networkExecutor.submit(() -> {
            try {
                JSONObject result = api.uploadCover(this, uri, currentId, this::updateUploadProgress);
                String uploadedUrl = result.optString("coverUrl", "");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    coverUrl = uploadedUrl;
                    bindCover(uploadedUrl, titleInput.getText().toString());
                    finishUploadProgress();
                    setEditorActionsEnabled(true);
                    statusText.setText("Đã cập nhật ảnh bìa.");
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    finishUploadProgress();
                    setEditorActionsEnabled(true);
                    statusText.setText(errorMessage(exception));
                    android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void loadStory(String id) {
        networkExecutor.execute(() -> {
            try {
                JSONObject response = api.getAuthorStory(id);
                JSONObject story = response.optJSONObject("story");
                JSONObject previewData = response.optJSONObject("preview");
                JSONArray volumes = previewData == null ? null : previewData.optJSONArray("volumes");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || story == null) return;
                    storyId = id;
                    fillEditor(story, volumes);
                });
            } catch (IOException | JSONException exception) {
                showError(exception);
            }
        });
    }

    private void openStory(String id) {
        importWarnings = null;
        showEditor();
        statusText.setText("Đang mở bản xem trước…");
        loadStory(id);
    }

    private void fillEditor(JSONObject story, JSONArray volumes) {
        titleInput.setText(story.optString("title", ""));
        authorInput.setText(story.optString("author", ""));
        languageInput.setText(story.optString("language", ""));
        summaryInput.setText(story.optString("summary", ""));
        coverUrl = story.optString("coverUrl", "");
        bindCover(coverUrl, story.optString("title", ""));
        renderWarnings(story);
        boolean editable = "draft".equals(story.optString("moderationStatus", "draft"))
                || "changes_requested".equals(story.optString("moderationStatus", ""));
        setEditorActionsEnabled(editable);
        renderPreview(volumes);
        String moderationStatus = story.optString("moderationStatus", "draft");
        if ("published".equals(moderationStatus) && "ongoing".equals(story.optString("lifecycleStatus", "ongoing"))) {
            MaterialButton updatesButton = new MaterialButton(this);
            updatesButton.setText("Bổ sung chương / tập mới");
            updatesButton.setAllCaps(false);
            updatesButton.setOnClickListener(view -> startActivity(new Intent(this, ContentUpdatesActivity.class)
                    .putExtra("story_id", storyId).putExtra("story_title", story.optString("title", ""))));
            preview.addView(updatesButton, 0);
        }
        if ("draft".equals(moderationStatus) || "changes_requested".equals(moderationStatus)) {
            statusText.setText("Bản nháp đã lưu trên máy chủ. Chưa hiện trong thư viện. Nhấn “Gửi kiểm duyệt” để chuyển bản thảo đến quản trị viên. Nếu chưa có AI, quản trị viên sẽ duyệt thủ công.");
        } else {
            statusText.setText("Trạng thái: " + statusLabel(moderationStatus) + " · " + StoryLifecycleLabels.label(story.optString("lifecycleStatus", "ongoing")) + ".");
        }
    }

    private void renderWarnings(JSONObject story) {
        StringBuilder text = new StringBuilder();
        appendWarnings(text, "Lưu ý khi đọc EPUB", importWarnings);
        appendWarnings(text, "Cảnh báo kiểm duyệt AI", story.optJSONArray("aiReviewWarnings"));
        warningsText.setText(text);
        warningsText.setVisibility(text.length() == 0 ? View.GONE : View.VISIBLE);
    }

    private void appendWarnings(StringBuilder output, String heading, JSONArray warnings) {
        if (warnings == null || warnings.length() == 0) return;
        if (output.length() > 0) output.append('\n');
        output.append(heading).append(':');
        for (int index = 0; index < warnings.length(); index++) {
            Object warning = warnings.opt(index);
            String message = warning instanceof JSONObject
                    ? ((JSONObject) warning).optString("message", warning.toString())
                    : String.valueOf(warning);
            output.append("\n• ").append(message);
        }
    }

    private void renderPreview(JSONArray volumes) {
        preview.removeAllViews();
        int volumeCount = volumes == null ? 0 : volumes.length();
        int chapterCount = 0;
        if (volumes != null) {
            for (int volumeIndex = 0; volumeIndex < volumes.length(); volumeIndex++) {
                JSONObject volume = volumes.optJSONObject(volumeIndex);
                JSONArray chapters = volume == null ? null : volume.optJSONArray("chapters");
                if (chapters != null) chapterCount += chapters.length();
            }
        }
        previewSummary.setText(volumeCount + " tập · " + chapterCount + " chương. Nội dung xem trước tối đa 3 chương đầu.");
        int previewed = 0;
        if (volumes != null) {
            for (int volumeIndex = 0; volumeIndex < volumes.length(); volumeIndex++) {
                JSONObject volume = volumes.optJSONObject(volumeIndex);
                if (volume == null) continue;
                addHeading(volume.optString("title", "Tập " + (volumeIndex + 1)), 19);
                JSONArray chapters = volume.optJSONArray("chapters");
                if (chapters == null) continue;
                for (int chapterIndex = 0; chapterIndex < chapters.length(); chapterIndex++) {
                    JSONObject chapter = chapters.optJSONObject(chapterIndex);
                    if (chapter == null) continue;
                    addHeading(chapter.optString("title", "Chương " + (chapterIndex + 1)), 16);
                    if (previewed < 3) {
                        LinearLayout blockContainer = new LinearLayout(this);
                        blockContainer.setOrientation(LinearLayout.VERTICAL);
                        preview.addView(blockContainer);
                        new ReaderBlockAdapter(this, blockContainer, ReaderPreferences.getFontSize(this))
                                .render(chapter.optJSONArray("blocks"), chapter.optString("content", ""));
                        previewed++;
                    }
                }
            }
        }
    }

    private void addHeading(String text, int sizeSp) {
        TextView heading = new TextView(this);
        heading.setText(text);
        heading.setTextColor(getColor(R.color.readlite_ink));
        heading.setTextSize(sizeSp);
        heading.setTypeface(heading.getTypeface(), android.graphics.Typeface.BOLD);
        heading.setPadding(0, 12, 0, 4);
        preview.addView(heading);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void saveMetadata() {
        if (storyId == null) return;
        JSONObject changes = new JSONObject();
        try {
            String title = titleInput.getText().toString().trim();
            String author = authorInput.getText().toString().trim();
            String language = languageInput.getText().toString().trim();
            if (title.isEmpty()) {
                titleInput.setError("Nhập tên truyện.");
                return;
            }
            changes.put("title", title);
            changes.put("author", author);
            changes.put("summary", summaryInput.getText().toString().trim());
            if (language.length() >= 2) changes.put("language", language);
        } catch (JSONException exception) {
            statusText.setText(errorMessage(exception));
            android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        setEditorActionsEnabled(false);
        statusText.setText("Đang lưu thông tin…");
        String id = storyId;
        networkExecutor.execute(() -> {
            try {
                api.updateStory(id, changes);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setEditorActionsEnabled(true);
                    loadStory(id);
                    android.widget.Toast.makeText(this, "Đã lưu thông tin truyện.", android.widget.Toast.LENGTH_LONG).show();
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        setEditorActionsEnabled(true);
                        statusText.setText(errorMessage(exception));
                    android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    private void submitForReview() {
        if (storyId == null) return;
        setEditorActionsEnabled(false);
        statusText.setText("Đang gửi bản nháp để kiểm duyệt…");
        String id = storyId;
        networkExecutor.execute(() -> {
            try {
                api.submitStory(id);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    statusText.setText("Đã gửi. Truyện sẽ tiếp tục chờ quản trị viên duyệt.");
                    showList();
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setEditorActionsEnabled(true);
                    statusText.setText(errorMessage(exception));
            android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void bindCover(String url, String title) {
        StoryCoverLoader.bind(url, title, coverImage, coverPlaceholder, 128, 184);
    }

    private void showEditor() {
        listPanel.setVisibility(View.GONE);
        editor.setVisibility(View.VISIBLE);
    }

    private void startUploadProgress() {
        uploadProgress.setVisibility(View.VISIBLE);
        uploadProgress.setIndeterminate(true);
        cancelButton.setVisibility(View.VISIBLE);
    }

    private void updateUploadProgress(long sent, long total) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (total > 0) {
                uploadProgress.setIndeterminate(false);
                uploadProgress.setProgress((int) Math.min(100, sent * 100 / total));
                statusText.setText("Đã tải " + (sent / 1024) + " / " + (total / 1024) + " KB…");
            }
        });
    }

    private void finishUploadProgress() {
        runOnUiThread(() -> {
            uploadProgress.setVisibility(View.GONE);
            cancelButton.setVisibility(View.GONE);
            activeUpload = null;
        });
    }

    private void finishUploadWithError(Exception exception) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            finishUploadProgress();
            setEditorActionsEnabled(true);
            statusText.setText(errorMessage(exception));
                        android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
        });
    }

    private void cancelUpload() {
        api.cancelActiveUpload();
        Future<?> upload = activeUpload;
        if (upload != null) upload.cancel(true);
        finishUploadProgress();
        findViewById(R.id.story_submission_import_button).setEnabled(true);
        setEditorActionsEnabled(true);
        statusText.setText("Đã hủy tải lên. Bản nháp chưa bị xóa.");
    }

    private void setEditorActionsEnabled(boolean enabled) {
        saveButton.setEnabled(enabled);
        submitButton.setEnabled(enabled);
        findViewById(R.id.story_submission_cover_button).setEnabled(enabled);
    }

    private void showError(Exception exception) {
        runOnUiThread(() -> {
            if (!isFinishing() && !isDestroyed()) {
                statusText.setText(errorMessage(exception));
                android.widget.Toast.makeText(this, errorMessage(exception), android.widget.Toast.LENGTH_LONG).show();
            }
        });
    }

    private String errorMessage(Exception exception) {
        if (exception instanceof CatalogApiClient.ApiException) {
            return exception.getMessage();
        }
        return "Không kết nối được ReadLite API. Hãy kiểm tra máy chủ rồi thử lại.";
    }

    private static String statusLabel(String status) {
        switch (status) {
            case "draft": return "Bản nháp";
            case "ai_review_pending": return "Đang chờ AI";
            case "admin_review_pending": return "Đang chờ quản trị viên duyệt";
            case "changes_requested": return "Cần chỉnh sửa";
            case "rejected": return "Đã từ chối";
            case "published": return "Đã xuất bản";
            default: return status;
        }
    }

    @Override
    public void onBackPressed() {
        if (activeUpload != null) {
            cancelUpload();
            return;
        }
        if (editor.getVisibility() == View.VISIBLE) {
            showList();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        api.cancelActiveUpload();
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
