package com.readlite.mobile;

import android.content.DialogInterface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ChapterReaderActivity extends AppCompatActivity {
    public static final String EXTRA_STORY_ID = "story_id";
    public static final String EXTRA_CHAPTER_ID = "chapter_id";
    public static final String EXTRA_RESUME_READING = "resume_reading";
    private static final String STATE_CHAPTER_ID = "current_chapter_id";
    private static final String STATE_POSITION = "current_position_permille";
    private static final long SAVE_DELAY_MS = 1200;

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ArrayList<String> chapterIds = new ArrayList<>();
    private final ArrayList<String> chapterLabels = new ArrayList<>();
    private final ArrayList<String> volumeTitles = new ArrayList<>();
    private final ArrayList<ArrayList<String>> volumeChapterIds = new ArrayList<>();
    private final ArrayList<ArrayList<String>> volumeChapterLabels = new ArrayList<>();

    private String storyId;
    private String chapterId;
    private String previousChapterId;
    private String nextChapterId;
    private int pendingRestorePermille;
    private boolean chapterLoaded;

    private TextView statusText;
    private TextView titleText;
    private LinearLayout contentContainer;
    private ReaderBlockAdapter blockAdapter;
    private JSONArray currentBlocks;
    private String currentLegacyContent = "";
    private TextView progressText;
    private ProgressBar progressBar;
    private MaterialButton previousButton;
    private MaterialButton nextButton;
    private MaterialButton previousBottomButton;
    private MaterialButton nextBottomButton;
    private MaterialButton decreaseFontButton;
    private MaterialButton increaseFontButton;
    private ScrollView readerScroll;
    private Runnable pendingSave;
    private AlertDialog bookmarkEditorDialog;
    private AlertDialog bookmarkListDialog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chapter_reader);

        readerScroll = findViewById(R.id.chapter_reader_scroll);
        SystemBarInsets.apply(findViewById(R.id.chapter_reader_root));
        statusText = findViewById(R.id.chapter_reader_status);
        titleText = findViewById(R.id.chapter_reader_title);
        contentContainer = findViewById(R.id.chapter_reader_content);
        blockAdapter = new ReaderBlockAdapter(this, contentContainer, ReaderPreferences.getFontSize(this));
        progressText = findViewById(R.id.chapter_reader_progress_text);
        progressBar = findViewById(R.id.chapter_reader_progress_bar);
        previousButton = findViewById(R.id.chapter_previous_button);
        nextButton = findViewById(R.id.chapter_next_button);
        previousBottomButton = findViewById(R.id.chapter_previous_bottom_button);
        nextBottomButton = findViewById(R.id.chapter_next_bottom_button);
        decreaseFontButton = findViewById(R.id.reader_font_decrease_button);
        increaseFontButton = findViewById(R.id.reader_font_increase_button);

        findViewById(R.id.chapter_reader_back_button).setOnClickListener(view -> finish());
        findViewById(R.id.reader_contents_button).setOnClickListener(view -> showContents());
        findViewById(R.id.reader_actions_button).setOnClickListener(view -> {
            android.widget.PopupMenu menu = new android.widget.PopupMenu(this, view);
            menu.getMenu().add(0, 1, 0, "Đánh dấu vị trí này");
            menu.getMenu().add(0, 2, 1, "Dấu trang");
            menu.getMenu().add(0, 3, 2, "Bình luận chương");
            menu.setOnMenuItemClickListener(item -> {
                if (item.getItemId() == 1) addBookmark();
                else if (item.getItemId() == 2) showBookmarks();
                else findViewById(R.id.chapter_comments_button).performClick();
                return true;
            });
            menu.show();
        });
        decreaseFontButton.setOnClickListener(view -> changeFontSize(-2));
        increaseFontButton.setOnClickListener(view -> changeFontSize(2));
        previousButton.setOnClickListener(view -> moveToChapter(previousChapterId));
        nextButton.setOnClickListener(view -> moveToChapter(nextChapterId));
        previousBottomButton.setOnClickListener(view -> moveToChapter(previousChapterId));
        nextBottomButton.setOnClickListener(view -> moveToChapter(nextChapterId));
        findViewById(R.id.chapter_comments_button).setOnClickListener(view -> {
            if (!chapterLoaded || storyId == null || chapterId == null) return;
            saveProgressNow();
            android.content.Intent comments = new android.content.Intent(this, CommentsActivity.class);
            comments.putExtra(CommentsActivity.EXTRA_STORY_ID, storyId);
            comments.putExtra(CommentsActivity.EXTRA_CHAPTER_ID, chapterId);
            startActivity(comments);
        });
        findViewById(R.id.reader_add_bookmark_button).setOnClickListener(view -> addBookmark());
        findViewById(R.id.reader_bookmarks_button).setOnClickListener(view -> showBookmarks());

        readerScroll.setOnScrollChangeListener((View view, int scrollX, int scrollY,
                                                 int oldScrollX, int oldScrollY) -> {
            updateProgressDisplay();
            scheduleProgressSave();
        });

        storyId = getIntent().getStringExtra(EXTRA_STORY_ID);
        chapterId = getIntent().getStringExtra(EXTRA_CHAPTER_ID);
        if (savedInstanceState != null) {
            chapterId = savedInstanceState.getString(STATE_CHAPTER_ID, chapterId);
            pendingRestorePermille = savedInstanceState.getInt(STATE_POSITION, 0);
        }
        if (storyId == null || storyId.isEmpty() || chapterId == null || chapterId.isEmpty()) {
            statusText.setText(R.string.catalog_connection_error);
            return;
        }
        loadChapter(
                chapterId,
                savedInstanceState == null
                        && getIntent().getBooleanExtra(EXTRA_RESUME_READING, false),
                savedInstanceState == null ? null : pendingRestorePermille
        );
    }

    private void changeFontSize(int delta) {
        int previousPosition = currentPermille();
        int fontSize = ReaderPreferences.adjustFontSize(this, delta);
        blockAdapter.setFontSizeSp(fontSize);
        blockAdapter.render(currentBlocks, currentLegacyContent);
        readerScroll.post(() -> {
            readerScroll.scrollTo(0, ReaderProgress.toScrollY(previousPosition, scrollRange()));
            updateProgressDisplay();
            scheduleProgressSave();
        });
    }

    private void moveToChapter(String targetChapterId) {
        if (targetChapterId == null || targetChapterId.isEmpty()) {
            return;
        }
        saveProgressNow();
        loadChapter(targetChapterId, false, null);
    }

    private void loadChapter(String requestedChapterId, boolean resumeSaved, Integer restoreOverride) {
        chapterLoaded = false;
        setChapterNavigationEnabled(false, false);
        statusText.setVisibility(View.VISIBLE);
        statusText.setText(R.string.chapter_loading);

        networkExecutor.execute(() -> {
            try {
                JSONObject savedProgress = null;
                try {
                    savedProgress = apiClient.getReadingProgress(storyId).optJSONObject("progress");
                } catch (IOException | JSONException ignored) {
                    // Guest reading works; progress synchronization requires a verified session.
                }

                JSONObject chapterResponse = apiClient.getChapters(storyId);
                JSONArray chapterList = chapterResponse.optJSONArray("chapters");
                JSONArray chapters = chapterList == null ? new JSONArray() : chapterList;
                JSONArray volumes = chapterResponse.optJSONArray("volumes");
                ArrayList<String> ids = new ArrayList<>();
                ArrayList<String> labels = new ArrayList<>();
                ArrayList<String> loadedVolumeTitles = new ArrayList<>();
                ArrayList<ArrayList<String>> loadedVolumeIds = new ArrayList<>();
                ArrayList<ArrayList<String>> loadedVolumeLabels = new ArrayList<>();
                if (volumes != null && volumes.length() > 0) {
                    for (int volumeIndex = 0; volumeIndex < volumes.length(); volumeIndex++) {
                        JSONObject volume = volumes.optJSONObject(volumeIndex);
                        if (volume == null) {
                            continue;
                        }
                        String volumeTitle = volume.optString("title", "");
                        JSONArray volumeChapters = volume.optJSONArray("chapters");
                        if (volumeChapters == null || volumeChapters.length() == 0) {
                            continue;
                        }
                        ArrayList<String> volumeIds = new ArrayList<>();
                        ArrayList<String> volumeLabels = new ArrayList<>();
                        for (int chapterIndex = 0; chapterIndex < volumeChapters.length(); chapterIndex++) {
                            JSONObject item = volumeChapters.optJSONObject(chapterIndex);
                            if (item == null) {
                                continue;
                            }
                            String itemId = item.optString("id", "");
                            if (itemId.trim().isEmpty()) {
                                continue;
                            }
                            int order = item.optInt("chapterOrder", chapterIndex + 1);
                            String label = ChapterLabels.fullLabel(this, order, item.optString("title", ""));
                            ids.add(itemId);
                            labels.add(label);
                            volumeIds.add(itemId);
                            volumeLabels.add(label);
                        }
                        if (!volumeIds.isEmpty()) {
                            loadedVolumeTitles.add(volumeTitle);
                            loadedVolumeIds.add(volumeIds);
                            loadedVolumeLabels.add(volumeLabels);
                        }
                    }
                } else {
                    for (int index = 0; index < chapters.length(); index++) {
                        JSONObject item = chapters.optJSONObject(index);
                        if (item == null) {
                            continue;
                        }
                        String itemId = item.optString("id", "");
                        if (itemId.trim().isEmpty()) {
                            continue;
                        }
                        int order = item.optInt("chapterOrder", index + 1);
                        ids.add(itemId);
                        labels.add(ChapterLabels.fullLabel(this, order, item.optString("title", "")));
                    }
                }
                String savedChapterId = savedProgress == null
                        ? null
                        : savedProgress.optString("chapterId", "");
                ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(
                        ids,
                        requestedChapterId,
                        savedChapterId,
                        resumeSaved
                );
                if (selection.chapterId == null) {
                    runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        chapterLoaded = false;
                        previousChapterId = null;
                        nextChapterId = null;
                        titleText.setText("");
                        currentBlocks = null;
                        currentLegacyContent = "";
                        blockAdapter.render(null, "");
                        volumeTitles.clear();
                        volumeChapterIds.clear();
                        volumeChapterLabels.clear();
                        setChapterNavigationEnabled(false, false);
                        statusText.setVisibility(View.VISIBLE);
                        statusText.setText(R.string.reader_toc_empty);
                        updateProgressDisplay();
                    });
                    return;
                }

                String resolvedChapterId = selection.chapterId;
                boolean recovered = selection.recovered;
                JSONObject chapter = null;
                ArrayList<String> chapterAttempts = new ArrayList<>();
                chapterAttempts.add(resolvedChapterId);
                for (String candidateId : ids) {
                    if (!chapterAttempts.contains(candidateId)) {
                        chapterAttempts.add(candidateId);
                    }
                }
                for (String candidateId : chapterAttempts) {
                    try {
                        chapter = apiClient.getChapter(storyId, candidateId)
                                .getJSONObject("chapter");
                        if (!candidateId.equals(selection.chapterId)) {
                            resolvedChapterId = candidateId;
                            recovered = true;
                        }
                        break;
                    } catch (CatalogApiClient.ApiException exception) {
                        if (exception.getStatusCode() != 404) {
                            throw exception;
                        }
                    }
                }
                if (chapter == null) {
                    throw new CatalogApiClient.ApiException(404, "Không tìm thấy chương.");
                }
                JSONObject selectedChapter = chapter;

                int activeIndex = ids.indexOf(resolvedChapterId);
                String previousId = null;
                String nextId = null;
                if (activeIndex > 0) {
                    previousId = ids.get(activeIndex - 1);
                }
                if (activeIndex >= 0 && activeIndex + 1 < ids.size()) {
                    nextId = ids.get(activeIndex + 1);
                }

                int restorePermille = 0;
                if (!recovered && restoreOverride != null) {
                    restorePermille = restoreOverride;
                } else if (!recovered && savedProgress != null
                        && resolvedChapterId.equals(savedProgress.optString("chapterId", ""))) {
                    restorePermille = savedProgress.optInt("positionPermille", 0);
                }
                int finalRestorePermille = Math.max(0, Math.min(1000, restorePermille));
                String finalChapterId = resolvedChapterId;
                String finalPreviousId = previousId;
                String finalNextId = nextId;
                boolean finalRecovered = recovered;
                ArrayList<String> finalIds = ids;
                ArrayList<String> finalLabels = labels;
                ArrayList<String> finalVolumeTitles = loadedVolumeTitles;
                ArrayList<ArrayList<String>> finalVolumeIds = loadedVolumeIds;
                ArrayList<ArrayList<String>> finalVolumeLabels = loadedVolumeLabels;

                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    chapterId = finalChapterId;
                    previousChapterId = finalPreviousId;
                    nextChapterId = finalNextId;
                    chapterIds.clear();
                    chapterIds.addAll(finalIds);
                    chapterLabels.clear();
                    chapterLabels.addAll(finalLabels);
                    volumeTitles.clear();
                    volumeTitles.addAll(finalVolumeTitles);
                    volumeChapterIds.clear();
                    volumeChapterIds.addAll(finalVolumeIds);
                    volumeChapterLabels.clear();
                    volumeChapterLabels.addAll(finalVolumeLabels);
                    titleText.setText(selectedChapter.optString("title", ""));
                    currentBlocks = selectedChapter.optJSONArray("blocks");
                    currentLegacyContent = selectedChapter.optString("content", "");
                    blockAdapter.render(currentBlocks, currentLegacyContent);
                    statusText.setVisibility(finalRecovered ? View.VISIBLE : View.GONE);
                    if (finalRecovered) {
                        statusText.setText(R.string.reader_progress_chapter_removed);
                    }
                    setChapterNavigationEnabled(previousChapterId != null, nextChapterId != null);
                    chapterLoaded = true;
                    readerScroll.post(() -> {
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        int range = scrollRange();
                        readerScroll.scrollTo(0, ReaderProgress.toScrollY(finalRestorePermille, range));
                        updateProgressDisplay();
                    });
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    statusText.setVisibility(View.VISIBLE);
                    statusText.setText(R.string.catalog_connection_error);
                    setChapterNavigationEnabled(previousChapterId != null, nextChapterId != null);
                });
            }
        });
    }

    private void setChapterNavigationEnabled(boolean hasPrevious, boolean hasNext) {
        previousButton.setEnabled(hasPrevious);
        previousBottomButton.setEnabled(hasPrevious);
        nextButton.setEnabled(hasNext);
        nextBottomButton.setEnabled(hasNext);
    }

    private void addBookmark() {
        if (!chapterLoaded || storyId == null || chapterId == null) {
            Toast.makeText(this, R.string.bookmark_wait_chapter, Toast.LENGTH_SHORT).show();
            return;
        }
        showBookmarkEditor(null, chapterId, currentPermille(), null);
    }

    private void showBookmarkEditor(JSONObject bookmark, String chapterToMark, int position,
                                    Runnable afterSave) {
        if (bookmarkEditorDialog != null && bookmarkEditorDialog.isShowing()) return;
        View content = getLayoutInflater().inflate(R.layout.dialog_reader_bookmark, null);
        EditText noteInput = content.findViewById(R.id.bookmark_note_input);
        TextView errorText = content.findViewById(R.id.bookmark_editor_status);
        TextView positionText = content.findViewById(R.id.bookmark_editor_position);
        positionText.setText(getString(R.string.bookmark_position, position / 10));
        noteInput.setText(bookmark == null ? "" : bookmark.optString("note", ""));
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(bookmark == null ? R.string.bookmark_add_title : R.string.bookmark_edit_title)
                .setView(content)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.bookmark_save, null)
                .create();
        bookmarkEditorDialog = dialog;
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> {
                    String note = noteInput.getText().toString().trim();
                    if (note.length() > 2000) {
                        noteInput.setError(getString(R.string.bookmark_note_too_long));
                        return;
                    }
                    noteInput.setEnabled(false);
                    dialog.setCancelable(false);
                    dialog.setCanceledOnTouchOutside(false);
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                    dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
                    errorText.setText(R.string.bookmark_saving);
                    networkExecutor.execute(() -> {
                        try {
                            if (bookmark == null) {
                                apiClient.addBookmark(storyId, chapterToMark, position, note);
                            } else {
                                apiClient.editBookmarkNote(bookmark.optString("id"), note);
                            }
                            runOnUiThread(() -> {
                                if (isFinishing() || isDestroyed()) return;
                                dialog.dismiss();
                                Toast.makeText(this, R.string.bookmark_saved, Toast.LENGTH_SHORT).show();
                                if (afterSave != null) afterSave.run();
                            });
                        } catch (IOException | JSONException exception) {
                            runOnUiThread(() -> {
                                if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                                noteInput.setEnabled(true);
                                dialog.setCancelable(true);
                                dialog.setCanceledOnTouchOutside(true);
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                                errorText.setText(bookmarkError(exception));
                            });
                        }
                    });
                }));
        dialog.show();
    }

    private void showBookmarks() {
        if (storyId == null || storyId.isEmpty()
                || (bookmarkListDialog != null && bookmarkListDialog.isShowing())) return;
        View content = getLayoutInflater().inflate(R.layout.dialog_reader_bookmarks, null);
        TextView listStatus = content.findViewById(R.id.bookmark_list_status);
        LinearLayout rows = content.findViewById(R.id.bookmark_list_rows);
        MaterialButton moreButton = content.findViewById(R.id.bookmark_list_more);
        BookmarkPageState state = new BookmarkPageState();
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.bookmark_list_title)
                .setView(content)
                .setNegativeButton(R.string.bookmark_close, null)
                .create();
        bookmarkListDialog = dialog;
        moreButton.setOnClickListener(view -> loadBookmarks(dialog, state, rows, listStatus, moreButton));
        dialog.show();
        loadBookmarks(dialog, state, rows, listStatus, moreButton);
    }

    private void loadBookmarks(AlertDialog dialog, BookmarkPageState state, LinearLayout rows,
                               TextView listStatus, MaterialButton moreButton) {
        if (state.loading || !dialog.isShowing()) return;
        state.loading = true;
        int requestedPage = state.page + 1;
        moreButton.setEnabled(false);
        listStatus.setText(R.string.bookmark_loading);
        networkExecutor.execute(() -> {
            try {
                JSONObject response = apiClient.getBookmarks(storyId, requestedPage);
                JSONArray bookmarks = response.optJSONArray("bookmarks");
                JSONObject pagination = response.optJSONObject("pagination");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                    state.loading = false;
                    state.page = requestedPage;
                    if (requestedPage == 1) rows.removeAllViews();
                    if (bookmarks != null) {
                        for (int index = 0; index < bookmarks.length(); index++) {
                            JSONObject bookmark = bookmarks.optJSONObject(index);
                            if (bookmark != null) {
                                rows.addView(bookmarkRow(bookmark, dialog, state, rows, listStatus, moreButton));
                            }
                        }
                    }
                    int count = rows.getChildCount();
                    int total = pagination == null ? count : pagination.optInt("total", count);
                    listStatus.setText(count == 0 ? getString(R.string.bookmark_empty)
                            : getString(R.string.bookmark_count, count, total));
                    moreButton.setText(R.string.bookmark_load_more);
                    moreButton.setEnabled(true);
                    moreButton.setVisibility(count < total ? View.VISIBLE : View.GONE);
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                    state.loading = false;
                    listStatus.setText(bookmarkError(exception));
                    moreButton.setText(R.string.bookmark_retry);
                    moreButton.setEnabled(true);
                    moreButton.setVisibility(View.VISIBLE);
                });
            }
        });
    }

    private View bookmarkRow(JSONObject bookmark, AlertDialog dialog, BookmarkPageState state,
                             LinearLayout rows, TextView listStatus, MaterialButton moreButton) {
        View row = getLayoutInflater().inflate(R.layout.item_reader_bookmark, rows, false);
        String targetChapterId = bookmark.isNull("chapterId") ? null : bookmark.optString("chapterId", "");
        boolean available = targetChapterId != null && !targetChapterId.isEmpty();
        int position = Math.max(0, Math.min(1000, bookmark.optInt("positionPermille", 0)));
        String title = available ? ChapterLabels.fullLabel(this, bookmark.optInt("chapterOrder", 1),
                bookmark.optString("chapterTitle", "")) : getString(R.string.bookmark_deleted_chapter);
        ((TextView) row.findViewById(R.id.bookmark_row_title)).setText(title);
        ((TextView) row.findViewById(R.id.bookmark_row_position)).setText(available
                ? getString(R.string.bookmark_position, position / 10)
                : getString(R.string.bookmark_deleted_explanation));
        String note = bookmark.optString("note", "");
        ((TextView) row.findViewById(R.id.bookmark_row_note)).setText(note.isEmpty()
                ? getString(R.string.bookmark_no_note) : note);
        MaterialButton openButton = row.findViewById(R.id.bookmark_row_open);
        openButton.setEnabled(available);
        openButton.setOnClickListener(view -> {
            if (!available) return;
            dialog.dismiss();
            saveProgressNow();
            loadChapter(targetChapterId, false, position);
        });
        Runnable refresh = () -> {
            if (!dialog.isShowing()) return;
            state.page = 0;
            loadBookmarks(dialog, state, rows, listStatus, moreButton);
        };
        row.findViewById(R.id.bookmark_row_edit).setOnClickListener(view ->
                showBookmarkEditor(bookmark, targetChapterId, position, refresh));
        row.findViewById(R.id.bookmark_row_delete).setOnClickListener(view -> {
            AlertDialog confirmation = new MaterialAlertDialogBuilder(this)
                    .setTitle(R.string.bookmark_delete_title)
                    .setMessage(R.string.bookmark_delete_message)
                    .setNegativeButton(android.R.string.cancel, null)
                    .setPositiveButton(R.string.bookmark_delete, null)
                    .create();
            confirmation.setOnShowListener(ignored -> confirmation.getButton(AlertDialog.BUTTON_POSITIVE)
                    .setOnClickListener(button -> {
                        confirmation.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                        confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
                        confirmation.setCancelable(false);
                        confirmation.setCanceledOnTouchOutside(false);
                        networkExecutor.execute(() -> {
                            try {
                                apiClient.deleteBookmark(bookmark.optString("id"));
                                runOnUiThread(() -> {
                                    if (isFinishing() || isDestroyed()) return;
                                    confirmation.dismiss();
                                    Toast.makeText(this, R.string.bookmark_deleted, Toast.LENGTH_SHORT).show();
                                    refresh.run();
                                });
                            } catch (IOException | JSONException exception) {
                                runOnUiThread(() -> {
                                    if (isFinishing() || isDestroyed() || !confirmation.isShowing()) return;
                                    confirmation.setMessage(bookmarkError(exception));
                                    confirmation.setCancelable(true);
                                    confirmation.setCanceledOnTouchOutside(true);
                                    confirmation.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                    confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                                });
                            }
                        });
                    }));
            bookmarkEditorDialog = confirmation;
            confirmation.show();
        });
        return row;
    }

    private String bookmarkError(Exception exception) {
        if (exception instanceof CatalogApiClient.ApiException) {
            if (((CatalogApiClient.ApiException) exception).getStatusCode() == 401) {
                return getString(R.string.bookmark_login_required);
            }
            return exception.getMessage();
        }
        return getString(R.string.bookmark_network_error);
    }

    private static final class BookmarkPageState {
        private int page;
        private boolean loading;
    }

    private void showContents() {
        if (chapterIds.isEmpty()) {
            statusText.setVisibility(View.VISIBLE);
            statusText.setText(R.string.reader_toc_empty);
            return;
        }
        if (volumeTitles.isEmpty()) {
            showChapterChoices(
                    getString(R.string.reader_toc_title),
                    chapterIds,
                    chapterLabels
            );
            return;
        }
        CharSequence[] titles = volumeTitles.toArray(new CharSequence[0]);
        new AlertDialog.Builder(this)
                .setTitle(R.string.reader_toc_title)
                .setItems(titles, (DialogInterface dialog, int which) ->
                        showChapterChoices(
                                volumeTitles.get(which),
                                volumeChapterIds.get(which),
                                volumeChapterLabels.get(which)
                        ))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void showChapterChoices(
            String title,
            ArrayList<String> ids,
            ArrayList<String> labels
    ) {
        CharSequence[] rows = labels.toArray(new CharSequence[0]);
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(rows, (DialogInterface dialog, int which) ->
                        moveToChapter(ids.get(which)))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }
    private int scrollRange() {
        if (readerScroll.getChildCount() == 0) {
            return 0;
        }
        return Math.max(0, readerScroll.getChildAt(0).getHeight() - readerScroll.getHeight());
    }

    private int currentPermille() {
        return ReaderProgress.toPermille(readerScroll.getScrollY(), scrollRange());
    }

    private void updateProgressDisplay() {
        int permille = currentPermille();
        progressBar.setProgress(permille);
        progressText.setText(getString(R.string.reader_progress, permille / 10));
    }

    private void scheduleProgressSave() {
        if (!chapterLoaded || storyId == null || chapterId == null) {
            return;
        }
        if (pendingSave != null) {
            mainHandler.removeCallbacks(pendingSave);
        }
        pendingSave = this::saveProgressNow;
        mainHandler.postDelayed(pendingSave, SAVE_DELAY_MS);
    }

    private void saveProgressNow() {
        if (!chapterLoaded || storyId == null || chapterId == null) {
            return;
        }
        if (pendingSave != null) {
            mainHandler.removeCallbacks(pendingSave);
            pendingSave = null;
        }
        String storyToSave = storyId;
        String chapterToSave = chapterId;
        int position = currentPermille();
        networkExecutor.execute(() -> {
            try {
                apiClient.saveReadingProgress(storyToSave, chapterToSave, position);
            } catch (IOException | JSONException exception) {
                if (exception instanceof CatalogApiClient.ApiException
                        && ((CatalogApiClient.ApiException) exception).getStatusCode() == 401) {
                    return;
                }
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        statusText.setVisibility(View.VISIBLE);
                        statusText.setText(R.string.reader_progress_save_error);
                    }
                });
            }
        });
    }

    @Override
    protected void onPause() {
        saveProgressNow();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (chapterId != null) {
            outState.putString(STATE_CHAPTER_ID, chapterId);
            outState.putInt(STATE_POSITION, currentPermille());
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (bookmarkEditorDialog != null) bookmarkEditorDialog.dismiss();
        if (bookmarkListDialog != null) bookmarkListDialog.dismiss();
        if (pendingSave != null) {
            mainHandler.removeCallbacks(pendingSave);
        }
        networkExecutor.shutdown();
        super.onDestroy();
    }
}
