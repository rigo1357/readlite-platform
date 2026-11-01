package com.readlite.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class PasswordActivity extends AppCompatActivity {
    public static final String EXTRA_MODE = "password_mode";
    public static final String EXTRA_EMAIL = "password_email";
    public static final String MODE_FORGOT = "forgot";
    public static final String MODE_RESET = "reset";
    public static final String MODE_CHANGE = "change";

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();
    private EditText emailInput;
    private EditText tokenInput;
    private EditText currentPasswordInput;
    private EditText newPasswordInput;
    private EditText confirmPasswordInput;
    private TextView statusText;
    private MaterialButton submitButton;
    private MaterialButton switchModeButton;
    private MaterialButton backButton;
    private String mode;
    private boolean sending;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_password);
        SystemBarInsets.apply(findViewById(R.id.password_root));
        emailInput = findViewById(R.id.password_email);
        tokenInput = findViewById(R.id.password_reset_token);
        currentPasswordInput = findViewById(R.id.password_current);
        newPasswordInput = findViewById(R.id.password_new);
        confirmPasswordInput = findViewById(R.id.password_confirm);
        statusText = findViewById(R.id.password_status);
        submitButton = findViewById(R.id.password_submit);
        switchModeButton = findViewById(R.id.password_switch_mode);
        backButton = findViewById(R.id.password_back);
        // Credentials and one-use tokens must not be copied to saved view state.
        tokenInput.setSaveEnabled(false);
        currentPasswordInput.setSaveEnabled(false);
        newPasswordInput.setSaveEnabled(false);
        confirmPasswordInput.setSaveEnabled(false);
        emailInput.setText(getIntent().getStringExtra(EXTRA_EMAIL));
        mode = savedInstanceState == null
                ? getIntent().getStringExtra(EXTRA_MODE) : savedInstanceState.getString(EXTRA_MODE);
        if (!MODE_CHANGE.equals(mode) && !MODE_RESET.equals(mode)) {
            mode = MODE_FORGOT;
        }
        backButton.setOnClickListener(view -> finish());
        submitButton.setOnClickListener(view -> submit());
        switchModeButton.setOnClickListener(view -> {
            mode = MODE_FORGOT.equals(mode) ? MODE_RESET : MODE_FORGOT;
            statusText.setText("");
            showMode();
        });
        confirmPasswordInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                if (!sending) submit();
                return true;
            }
            return false;
        });
        showMode();
        readResetLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readResetLink(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putString(EXTRA_MODE, mode);
        super.onSaveInstanceState(state);
    }

    private void readResetLink(Intent intent) {
        Uri link = intent.getData();
        if (link == null) return;
        String token = extractResetToken(link.toString());
        intent.setData(null);
        if (sending) return;
        mode = MODE_RESET;
        showMode();
        if (token == null) {
            statusText.setText(R.string.password_token_invalid);
        } else {
            tokenInput.setText(token);
            statusText.setText(R.string.password_link_ready);
        }
    }

    private void showMode() {
        boolean forgot = MODE_FORGOT.equals(mode);
        boolean change = MODE_CHANGE.equals(mode);
        ((TextView) findViewById(R.id.password_title)).setText(change
                ? R.string.password_change_title : forgot
                ? R.string.password_forgot_title : R.string.password_reset_title);
        ((TextView) findViewById(R.id.password_subtitle)).setText(change
                ? R.string.password_change_subtitle : forgot
                ? R.string.password_forgot_subtitle : R.string.password_reset_subtitle);
        findViewById(R.id.password_email_fields).setVisibility(forgot ? View.VISIBLE : View.GONE);
        findViewById(R.id.password_token_fields).setVisibility(
                !forgot && !change ? View.VISIBLE : View.GONE);
        findViewById(R.id.password_current_fields).setVisibility(change ? View.VISIBLE : View.GONE);
        findViewById(R.id.password_new_fields).setVisibility(forgot ? View.GONE : View.VISIBLE);
        submitButton.setText(change ? R.string.password_change_submit : forgot
                ? R.string.password_send_instructions : R.string.password_reset_submit);
        switchModeButton.setVisibility(change ? View.GONE : View.VISIBLE);
        switchModeButton.setText(forgot ? R.string.password_have_token : R.string.password_request_again);
    }

    private void submit() {
        if (sending) return;
        emailInput.setError(null);
        tokenInput.setError(null);
        currentPasswordInput.setError(null);
        newPasswordInput.setError(null);
        confirmPasswordInput.setError(null);
        final String submittedMode = mode;
        final String email = emailInput.getText().toString().trim();
        final String password = newPasswordInput.getText().toString();
        final String currentPassword = currentPasswordInput.getText().toString();
        final String token = MODE_RESET.equals(mode)
                ? extractResetToken(tokenInput.getText().toString()) : null;
        if (MODE_FORGOT.equals(mode)) {
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches() || email.length() > 254) {
                emailInput.setError(getString(R.string.password_email_invalid));
                emailInput.requestFocus();
                return;
            }
        } else {
            if (MODE_CHANGE.equals(mode)
                    && (currentPassword.isEmpty() || currentPassword.getBytes(StandardCharsets.UTF_8).length > 72)) {
                currentPasswordInput.setError(getString(R.string.password_current_required));
                currentPasswordInput.requestFocus();
                return;
            }
            if (MODE_RESET.equals(mode) && token == null) {
                tokenInput.setError(getString(R.string.password_token_invalid));
                tokenInput.requestFocus();
                return;
            }
            if (password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
                newPasswordInput.setError(getString(R.string.password_new_invalid));
                newPasswordInput.requestFocus();
                return;
            }
            if (!password.equals(confirmPasswordInput.getText().toString())) {
                confirmPasswordInput.setError(getString(R.string.password_confirm_invalid));
                confirmPasswordInput.requestFocus();
                return;
            }
        }
        setSending(true);
        statusText.setText(R.string.password_sending);
        networkExecutor.execute(() -> {
            try {
                if (MODE_FORGOT.equals(submittedMode)) {
                    apiClient.forgotPassword(email);
                } else if (MODE_CHANGE.equals(submittedMode)) {
                    apiClient.changePassword(currentPassword, password);
                } else {
                    apiClient.resetPassword(token, password);
                }
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setSending(false);
                    if (MODE_FORGOT.equals(submittedMode)) {
                        mode = MODE_RESET;
                        showMode();
                        statusText.setText(R.string.password_instructions_sent);
                    } else {
                        completePasswordChange();
                    }
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    setSending(false);
                    statusText.setText(exception instanceof CatalogApiClient.ApiException
                            ? exception.getMessage() : getString(R.string.password_network_error));
                });
            }
        });
    }

    private void setSending(boolean busy) {
        sending = busy;
        submitButton.setEnabled(!busy);
        switchModeButton.setEnabled(!busy);
        backButton.setEnabled(!busy);
        emailInput.setEnabled(!busy);
        tokenInput.setEnabled(!busy);
        currentPasswordInput.setEnabled(!busy);
        newPasswordInput.setEnabled(!busy);
        confirmPasswordInput.setEnabled(!busy);
    }

    private void completePasswordChange() {
        ReadLiteApplication.cookieManager().getCookieStore().removeAll();
        currentPasswordInput.setText("");
        newPasswordInput.setText("");
        confirmPasswordInput.setText("");
        tokenInput.setText("");
        Toast.makeText(this, R.string.password_saved, Toast.LENGTH_LONG).show();
        Intent login = new Intent(this, MainActivity.class);
        login.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(login);
        finish();
    }

    private static String extractResetToken(String value) {
        String token = value == null ? "" : value.trim();
        if (token.matches("[A-Za-z0-9_-]{32,128}")) return token;
        try {
            Uri link = Uri.parse(token);
            String scheme = link.getScheme();
            if (scheme == null || !("https".equalsIgnoreCase(scheme)
                    || "http".equalsIgnoreCase(scheme) || "readlite".equalsIgnoreCase(scheme))) {
                return null;
            }
            token = link.getQueryParameter("token");
            return token != null && token.matches("[A-Za-z0-9_-]{32,128}") ? token : null;
        } catch (IllegalArgumentException | UnsupportedOperationException exception) {
            return null;
        }
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
