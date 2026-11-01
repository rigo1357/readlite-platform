package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.switchmaterial.SwitchMaterial;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AccountActivity extends AppCompatActivity {
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();

    private TextView statusText;
    private TextView identityText;
    private MaterialButton signInButton;
    private MaterialButton signOutButton;
    private MaterialButton manageStoriesButton;
    private MaterialButton reviewQueueButton;
    private MaterialButton editProfileButton;
    private MaterialButton changePasswordButton;
    private JSONObject currentUser;
    private AlertDialog profileDialog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_account);
        SystemBarInsets.apply(findViewById(R.id.account_root));

        statusText = findViewById(R.id.account_status);
        identityText = findViewById(R.id.account_identity);
        signInButton = findViewById(R.id.account_sign_in_button);
        signOutButton = findViewById(R.id.account_sign_out_button);
        manageStoriesButton = findViewById(R.id.account_manage_stories_button);
        reviewQueueButton = findViewById(R.id.account_review_queue_button);
        editProfileButton = findViewById(R.id.account_edit_profile_button);
        changePasswordButton = findViewById(R.id.account_change_password_button);
        SwitchMaterial themeSwitch = findViewById(R.id.account_theme_switch);
        BottomNavigationView navigation = findViewById(R.id.account_bottom_navigation);

        themeSwitch.setChecked(ThemeManager.isDarkTheme(this));
        themeSwitch.setOnCheckedChangeListener((button, checked) ->
                ThemeManager.setDarkTheme(this, checked));
        signInButton.setOnClickListener(view ->
                startActivity(new Intent(this, MainActivity.class)));
        signOutButton.setOnClickListener(view -> logout());
        editProfileButton.setOnClickListener(view -> editProfile());
        changePasswordButton.setOnClickListener(view -> {
            Intent intent = new Intent(this, PasswordActivity.class);
            intent.putExtra(PasswordActivity.EXTRA_MODE, PasswordActivity.MODE_CHANGE);
            startActivity(intent);
        });
        manageStoriesButton.setOnClickListener(view ->
                startActivity(new Intent(this, StorySubmissionActivity.class)));
        reviewQueueButton.setOnClickListener(view ->
                startActivity(new Intent(this, AdminReviewActivity.class)));

        findViewById(R.id.account_open_bookshelf).setOnClickListener(view ->
                startActivity(new Intent(this, BookshelfActivity.class)));
        findViewById(R.id.account_open_notifications).setOnClickListener(view ->
                startActivity(new Intent(this, ReaderUpdatesActivity.class)));
        findViewById(R.id.account_open_following).setOnClickListener(view -> {
            Intent updates = new Intent(this, ReaderUpdatesActivity.class);
            updates.putExtra(ReaderUpdatesActivity.EXTRA_FOLLOWING, true);
            startActivity(updates);
        });
        PrimaryNavigation.bind(this, R.id.account_bottom_navigation, R.id.catalog_nav_account);
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadAccount();
    }

    private void loadAccount() {
        statusText.setText(R.string.account_loading);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.getCurrentUser();
                JSONObject user = body.optJSONObject("user");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    if (user == null) {
                        showSignedOut(R.string.account_signed_out);
                        return;
                    }
                    showAccount(user);
                });
            } catch (CatalogApiClient.ApiException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    if (exception.getStatusCode() == 401) {
                        showSignedOut(R.string.account_signed_out);
                    } else {
                        statusText.setText(R.string.account_load_error);
                    }
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        statusText.setText(R.string.account_load_error);
                    }
                });
            }
        });
    }

    private void showSignedOut(int messageId) {
        currentUser = null;
        identityText.setVisibility(View.GONE);
        signInButton.setVisibility(View.VISIBLE);
        signOutButton.setVisibility(View.GONE);
        manageStoriesButton.setVisibility(View.GONE);
        reviewQueueButton.setVisibility(View.GONE);
        editProfileButton.setVisibility(View.GONE);
        changePasswordButton.setVisibility(View.GONE);
        statusText.setText(messageId);
    }

    private void showAccount(JSONObject user) {
        currentUser = user;
        String name = user.optString("displayName", "");
        String email = user.optString("email", "");
        String role = user.optString("role", "user");
        identityText.setText(getString(R.string.account_identity, name, email));
        identityText.setVisibility(View.VISIBLE);
        ((TextView) findViewById(R.id.account_avatar)).setText(
                name.isEmpty() ? "R" : name.substring(0, name.offsetByCodePoints(0, 1))
                        .toUpperCase(java.util.Locale.ROOT));
        signInButton.setVisibility(View.GONE);
        signOutButton.setVisibility(View.VISIBLE);
        editProfileButton.setVisibility(View.VISIBLE);
        changePasswordButton.setVisibility(View.VISIBLE);
        manageStoriesButton.setVisibility(
                "author".equals(role) || "admin".equals(role) ? View.VISIBLE : View.GONE);
        reviewQueueButton.setVisibility("admin".equals(role) ? View.VISIBLE : View.GONE);
        statusText.setText("admin".equals(role) ? "Quản trị viên"
                : "author".equals(role) ? "Tác giả" : "Thành viên ReadLite");
    }

    private void editProfile() {
        if (currentUser == null || (profileDialog != null && profileDialog.isShowing())) {
            return;
        }
        View content = getLayoutInflater().inflate(R.layout.dialog_account_profile, null);
        EditText nameInput = content.findViewById(R.id.profile_display_name);
        EditText usernameInput = content.findViewById(R.id.profile_username);
        TextView emailText = content.findViewById(R.id.profile_email);
        TextView messageText = content.findViewById(R.id.profile_message);
        nameInput.setText(currentUser.optString("displayName", ""));
        usernameInput.setText(currentUser.optString("username", ""));
        emailText.setText(currentUser.optString("email", ""));

        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.profile_edit_title)
                .setView(content)
                .setNegativeButton(R.string.profile_cancel, null)
                .setPositiveButton(R.string.profile_save, null)
                .create();
        profileDialog = dialog;
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> saveProfile(dialog, nameInput, usernameInput, messageText)));
        dialog.show();
    }

    private void saveProfile(AlertDialog dialog, EditText nameInput, EditText usernameInput,
                             TextView messageText) {
        String name = nameInput.getText().toString().trim();
        String username = usernameInput.getText().toString().trim();
        nameInput.setError(null);
        usernameInput.setError(null);
        if (name.isEmpty() || name.length() > 100) {
            nameInput.setError(getString(R.string.profile_name_invalid));
            nameInput.requestFocus();
            return;
        }
        if (username.length() < 4 || username.length() > 20) {
            usernameInput.setError(getString(R.string.profile_username_invalid));
            usernameInput.requestFocus();
            return;
        }
        setProfileSaving(dialog, nameInput, usernameInput, true);
        messageText.setText(R.string.profile_saving);
        networkExecutor.execute(() -> {
            try {
                JSONObject body = apiClient.updateProfile(username, name);
                JSONObject updatedUser = body.getJSONObject("user");
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    showAccount(updatedUser);
                    dialog.dismiss();
                    Toast.makeText(this, R.string.profile_saved, Toast.LENGTH_SHORT).show();
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || !dialog.isShowing()) {
                        return;
                    }
                    setProfileSaving(dialog, nameInput, usernameInput, false);
                    if (exception instanceof CatalogApiClient.ApiException) {
                        CatalogApiClient.ApiException apiError = (CatalogApiClient.ApiException) exception;
                        if (apiError.getStatusCode() == 401) {
                            showSignedOut(R.string.account_signed_out);
                            messageText.setText(R.string.profile_session_expired);
                        } else {
                            messageText.setText(apiError.getMessage());
                            if (apiError.getStatusCode() == 409) {
                                usernameInput.setError(getString(R.string.profile_username_taken));
                                usernameInput.requestFocus();
                            }
                        }
                    } else {
                        messageText.setText(R.string.profile_save_error);
                    }
                });
            }
        });
    }

    private void setProfileSaving(AlertDialog dialog, EditText nameInput, EditText usernameInput,
                                  boolean saving) {
        nameInput.setEnabled(!saving);
        usernameInput.setEnabled(!saving);
        dialog.setCancelable(!saving);
        dialog.setCanceledOnTouchOutside(!saving);
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(!saving);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!saving);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText(
                saving ? R.string.profile_saving : R.string.profile_save);
    }

    private void logout() {
        signOutButton.setEnabled(false);
        statusText.setText(R.string.account_signing_out);
        networkExecutor.execute(() -> {
            try {
                apiClient.logout();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) {
                        return;
                    }
                    signOutButton.setEnabled(true);
                    java.net.CookieHandler handler = java.net.CookieHandler.getDefault();
                    if (handler instanceof java.net.CookieManager) {
                        ((java.net.CookieManager) handler).getCookieStore().removeAll();
                    }
                    Intent login = new Intent(this, MainActivity.class);
                    login.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(login);
                    finish();
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        signOutButton.setEnabled(true);
                        statusText.setText(R.string.account_logout_error);
                    }
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (profileDialog != null) {
            profileDialog.dismiss();
        }
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
