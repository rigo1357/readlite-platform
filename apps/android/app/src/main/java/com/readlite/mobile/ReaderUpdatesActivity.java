package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.tabs.TabLayout;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** In-app chapter announcements and the reader's independently managed follow list. */
public final class ReaderUpdatesActivity extends AppCompatActivity {
    public static final String EXTRA_FOLLOWING = "show_following";
    private final CatalogApiClient api = new CatalogApiClient();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private TextView status;
    private TabLayout tabs;
    private CheckBox unread;
    private boolean busy;
    private boolean followingTab;
    private int page;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_reader_updates);
        SystemBarInsets.apply(findViewById(R.id.reader_updates_root));
        list = findViewById(R.id.reader_updates_list);
        status = findViewById(R.id.reader_updates_status);
        tabs = findViewById(R.id.reader_updates_tabs);
        unread = findViewById(R.id.reader_updates_unread);
        tabs.addTab(tabs.newTab().setText("Thông báo"));
        tabs.addTab(tabs.newTab().setText("Đang theo dõi"));
        tabs.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override public void onTabSelected(TabLayout.Tab tab) {
                followingTab = tab.getPosition() == 1;
                findViewById(R.id.reader_updates_filters).setVisibility(followingTab ? View.GONE : View.VISIBLE);
                list.removeAllViews();
                findViewById(R.id.reader_updates_more).setVisibility(View.GONE);
                load(true);
            }
            @Override public void onTabUnselected(TabLayout.Tab tab) { }
            @Override public void onTabReselected(TabLayout.Tab tab) { }
        });
        unread.setChecked(state != null && state.getBoolean("unread"));
        unread.setOnCheckedChangeListener((button, checked) -> load(true));
        findViewById(R.id.reader_updates_back).setOnClickListener(view -> finish());
        findViewById(R.id.reader_updates_refresh).setOnClickListener(view -> load(true));
        findViewById(R.id.reader_updates_more).setOnClickListener(view -> load(false));
        findViewById(R.id.reader_updates_read_all).setOnClickListener(view -> mutate(api::readAllNotifications, null));
        boolean showFollowing = state == null ? getIntent().getBooleanExtra(EXTRA_FOLLOWING, false) : state.getBoolean("following");
        if (showFollowing) tabs.selectTab(tabs.getTabAt(1));
    }

    @Override protected void onResume() { super.onResume(); load(true); }

    private void busy(boolean value) {
        busy = value;
        findViewById(R.id.reader_updates_refresh).setEnabled(!value);
        findViewById(R.id.reader_updates_more).setEnabled(!value);
        findViewById(R.id.reader_updates_read_all).setEnabled(!value);
        unread.setEnabled(!value);
        if (tabs.getChildAt(0) instanceof ViewGroup) enable((ViewGroup) tabs.getChildAt(0), !value);
        enable(list, !value);
    }
    private void enable(ViewGroup group, boolean enabled) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            child.setEnabled(enabled && !Boolean.FALSE.equals(child.getTag()));
            if (child instanceof ViewGroup) enable((ViewGroup) child, enabled);
        }
    }
    private void load(boolean reset) {
        if (busy) return;
        busy(true);
        status.setText("Đang tải…");
        int requested = reset ? 1 : page + 1;
        boolean follows = followingTab;
        boolean onlyUnread = unread.isChecked();
        executor.execute(() -> {
            try {
                JSONObject body = follows ? api.getFollowing(requested) : api.getNotifications(requested, onlyUnread);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (reset) list.removeAllViews();
                    JSONArray items = body.optJSONArray(follows ? "stories" : "notifications");
                    if (items != null) for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.optJSONObject(i);
                        if (item != null) addRow(item, follows);
                    }
                    page = requested;
                    JSONObject pagination = body.optJSONObject("pagination");
                    int total = pagination == null ? 0 : pagination.optInt("total");
                    int unreadCount = body.optInt("unreadCount");
                    status.setText(follows ? (total == 0 ? "Bạn chưa theo dõi truyện nào. Mở chi tiết truyện và chọn Theo dõi chương mới." : total + " truyện đang theo dõi")
                            : total == 0 ? (onlyUnread ? "Không có thông báo chưa đọc." : "Chưa có thông báo. Theo dõi truyện để nhận cập nhật chương mới.") : unreadCount + " thông báo chưa đọc");
                    findViewById(R.id.reader_updates_more).setVisibility(page * 20 < total ? View.VISIBLE : View.GONE);
                    busy(false);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    busy(false);
                    status.setText(error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Không tải được cập nhật. Nhấn Tải lại để thử lại.");
                });
            }
        });
    }
    private TextView text(String value, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(bold ? 16 : 14);
        view.setTextColor(getColor(bold ? R.color.readlite_ink : R.color.readlite_muted));
        view.setPadding(0, 8, 0, 8);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }
    private MaterialButton button(LinearLayout row, String label, View.OnClickListener listener) {
        MaterialButton button = new MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(listener);
        row.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return button;
    }
    private void addRow(JSONObject item, boolean follows) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, 16, 0, 16);
        if (follows) {
            boolean available = item.optBoolean("available");
            row.addView(text(item.optString("title"), true));
            row.addView(text(available ? item.optString("author") + " · " + item.optInt("totalChapters") + " chương" : "Bạn vẫn có thể bỏ theo dõi truyện này.", false));
            MaterialButton open = button(row, "Chi tiết truyện", view -> openStory(item.optString("id")));
            open.setTag(available);
            open.setEnabled(available);
            button(row, "Bỏ theo dõi", view -> new MaterialAlertDialogBuilder(this).setTitle("Bỏ theo dõi truyện?")
                    .setMessage("Bạn sẽ không nhận thêm thông báo chương mới của truyện này.")
                    .setNegativeButton("Hủy", null)
                    .setPositiveButton("Bỏ theo dõi", (dialog, which) -> mutate(() -> api.setStoryFollow(item.optString("id"), false), null)).show());
        } else {
            row.addView(text((item.isNull("readAt") ? "● " : "") + item.optString("storyTitle"), true));
            boolean completed = "story_completed".equals(item.optString("kind"));
            row.addView(text(completed ? "Truyện đã hoàn thành. Bạn có thể đọc trọn bộ các chương đã xuất bản." : "Chương mới: " + item.optString("chapterTitle"), false));
            String date = item.optString("createdAt", "");
            if (date.length() >= 10) row.addView(text(date.substring(0, 10), false));
            boolean available = item.optBoolean("chapterAvailable") && !item.isNull("chapterId");
            if (!available && !completed) row.addView(text("Chương này đã bị xóa. Bạn có thể mở chi tiết truyện.", false));
            button(row, available ? "Đọc chương mới" : "Chi tiết truyện", view -> mutate(() -> api.readNotification(item.optString("id")), () -> {
                if (!available) { openStory(item.optString("storyId")); return; }
                Intent reader = new Intent(this, ChapterReaderActivity.class);
                reader.putExtra(ChapterReaderActivity.EXTRA_STORY_ID, item.optString("storyId"));
                reader.putExtra(ChapterReaderActivity.EXTRA_CHAPTER_ID, item.optString("chapterId"));
                startActivity(reader);
            }));
            if (item.isNull("readAt")) button(row, "Đánh dấu đã đọc", view -> mutate(() -> api.readNotification(item.optString("id")), null));
        }
        View line = new View(this);
        line.setBackgroundColor(getColor(R.color.readlite_line));
        row.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        list.addView(row);
    }
    private void openStory(String id) {
        Intent detail = new Intent(this, StoryDetailActivity.class);
        detail.putExtra(StoryDetailActivity.EXTRA_STORY_ID, id);
        startActivity(detail);
    }
    private interface Request { JSONObject run() throws IOException, JSONException; }
    private void mutate(Request request, Runnable after) {
        if (busy) return;
        busy(true);
        status.setText("Đang cập nhật…");
        executor.execute(() -> {
            try {
                request.run();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    busy(false);
                    if (after != null) after.run();
                    else load(true);
                });
            } catch (IOException | JSONException error) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    busy(false);
                    status.setText(error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Chưa cập nhật được. Hãy thử lại.");
                });
            }
        });
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("following", followingTab);
        state.putBoolean("unread", unread.isChecked());
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
