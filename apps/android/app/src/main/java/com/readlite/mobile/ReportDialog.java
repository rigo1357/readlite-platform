package com.readlite.mobile;

import android.text.InputFilter;
import android.text.InputType;
import android.widget.EditText;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import java.io.IOException;
import org.json.JSONException;

/** Report a story, review or comment without navigating away from the current screen. */
public final class ReportDialog {
    private ReportDialog() { }

    public static void show(AppCompatActivity activity, String type, String id) {
        if (id == null || id.isEmpty() || activity.isFinishing()) return;
        EditText reason = new EditText(activity);
        reason.setHint("Nêu rõ lý do báo cáo (tối đa 2000 ký tự)");
        reason.setContentDescription("Lý do báo cáo");
        reason.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        reason.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2000)});
        reason.setMinLines(3);
        reason.setMaxLines(8);
        int padding = (int) (20 * activity.getResources().getDisplayMetrics().density);
        reason.setPadding(padding, padding, padding, padding);
        AlertDialog dialog = new MaterialAlertDialogBuilder(activity).setTitle("Báo cáo nội dung")
                .setMessage("Quản trị viên sẽ xem xét nội dung và lý do bạn gửi.")
                .setView(reason).setNegativeButton("Hủy", null).setPositiveButton("Gửi báo cáo", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String text = reason.getText().toString().trim();
            if (text.isEmpty()) { reason.setError("Vui lòng nhập lý do."); return; }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            reason.setEnabled(false);
            dialog.setCancelable(false);
            new Thread(() -> {
                try {
                    new CatalogApiClient().reportContent(type, id, text);
                    activity.runOnUiThread(() -> {
                        if (activity.isFinishing() || activity.isDestroyed()) return;
                        dialog.dismiss();
                        Toast.makeText(activity, "Đã gửi báo cáo để quản trị viên xem xét.", Toast.LENGTH_LONG).show();
                    });
                } catch (IOException | JSONException error) {
                    activity.runOnUiThread(() -> {
                        if (activity.isFinishing() || activity.isDestroyed() || !dialog.isShowing()) return;
                        reason.setEnabled(true);
                        reason.setError(error instanceof CatalogApiClient.ApiException ? error.getMessage() : "Không gửi được báo cáo. Hãy thử lại.");
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                        dialog.setCancelable(true);
                    });
                }
            }, "readlite-report").start();
        }));
        dialog.show();
    }
}
