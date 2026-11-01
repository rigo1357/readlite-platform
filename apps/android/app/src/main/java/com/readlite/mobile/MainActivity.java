package com.readlite.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends AppCompatActivity {
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final CatalogApiClient apiClient = new CatalogApiClient();

    private MaterialButton backButton;
    private MaterialButton loginModeButton;
    private MaterialButton registerModeButton;
    private MaterialButton submitAuthButton;
    private MaterialButton forgotPasswordButton;
    private MaterialButton resendVerificationButton;
    private EditText displayNameInput;
    private EditText usernameInput;
    private EditText emailInput;
    private EditText passwordInput;
    private TextView authTitle;
    private TextView authSubtitle;
    private TextView connectionStatus;
    private boolean registerMode;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        SystemBarInsets.apply(findViewById(R.id.auth_root));

        backButton = findViewById(R.id.auth_back_button);
        loginModeButton = findViewById(R.id.login_mode_button);
        registerModeButton = findViewById(R.id.register_mode_button);
        submitAuthButton = findViewById(R.id.submit_auth_button);
        forgotPasswordButton = findViewById(R.id.auth_forgot_password_button);
        resendVerificationButton = findViewById(R.id.auth_resend_verification_button);
        displayNameInput = findViewById(R.id.display_name_input);
        usernameInput = findViewById(R.id.username_input);
        emailInput = findViewById(R.id.email_input);
        passwordInput = findViewById(R.id.password_input);
        passwordInput.setSaveEnabled(false);
        authTitle = findViewById(R.id.auth_title);
        authSubtitle = findViewById(R.id.auth_subtitle);
        connectionStatus = findViewById(R.id.connection_status);

        backButton.setOnClickListener(view -> showMode(false));
        loginModeButton.setOnClickListener(view -> showMode(false));
        registerModeButton.setOnClickListener(view -> showMode(true));
        submitAuthButton.setOnClickListener(view -> submitAuth());
        forgotPasswordButton.setOnClickListener(view -> {
            Intent intent = new Intent(this, PasswordActivity.class);
            intent.putExtra(PasswordActivity.EXTRA_MODE, PasswordActivity.MODE_FORGOT);
            intent.putExtra(PasswordActivity.EXTRA_EMAIL, emailInput.getText().toString().trim());
            startActivity(intent);
        });
        resendVerificationButton.setOnClickListener(view -> resendVerification());
        passwordInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                if (submitAuthButton.isEnabled()) submitAuth();
                return true;
            }
            return false;
        });
        showMode(savedInstanceState != null && savedInstanceState.getBoolean("register_mode", false));
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("register_mode", registerMode);
        super.onSaveInstanceState(state);
    }

    private void showMode(boolean shouldRegister) {
        registerMode = shouldRegister;
        findViewById(R.id.register_fields).setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        findViewById(R.id.auth_password_hint).setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        backButton.setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        loginModeButton.setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        registerModeButton.setVisibility(shouldRegister ? View.GONE : View.VISIBLE);
        forgotPasswordButton.setVisibility(shouldRegister ? View.GONE : View.VISIBLE);
        ((TextView) findViewById(R.id.auth_switch_prompt)).setText(
                shouldRegister ? "Bạn đã có tài khoản?" : "Chưa có tài khoản?");
        displayNameInput.setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        usernameInput.setVisibility(shouldRegister ? View.VISIBLE : View.GONE);
        authTitle.setText(shouldRegister
                ? R.string.auth_title_register
                : R.string.auth_title_login);
        authSubtitle.setText(shouldRegister
                ? R.string.auth_subtitle_register
                : R.string.auth_subtitle_login);
        submitAuthButton.setText(shouldRegister
                ? R.string.auth_submit_register
                : R.string.auth_submit_login);
        passwordInput.setText("");
        connectionStatus.setText("");
    }

    private void submitAuth() {
        final boolean creatingAccount = registerMode;
        final String displayName = displayNameInput.getText().toString().trim();
        final String username = usernameInput.getText().toString().trim();
        final String email = emailInput.getText().toString().trim();
        final String password = passwordInput.getText().toString();

        if (email.isEmpty()
                || password.isEmpty()
                || (creatingAccount && (displayName.isEmpty() || username.isEmpty()))) {
            connectionStatus.setText(R.string.auth_required_fields);
            return;
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            emailInput.setError("Nhập địa chỉ email hợp lệ.");
            emailInput.requestFocus();
            return;
        }
        if (creatingAccount && (username.length() < 4 || username.length() > 20)) {
            usernameInput.setError("Tên người dùng cần từ 4 đến 20 ký tự.");
            usernameInput.requestFocus();
            return;
        }
        if (creatingAccount && (password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72)) {
            passwordInput.setError("Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte.");
            passwordInput.requestFocus();
            return;
        }

        final JSONObject requestBody = new JSONObject();
        try {
            requestBody.put("email", email);
            requestBody.put("password", password);
            if (creatingAccount) {
                requestBody.put("displayName", displayName);
                requestBody.put("username", username);
            }
        } catch (JSONException exception) {
            connectionStatus.setText(R.string.auth_invalid_response);
            return;
        }

        submitAuthButton.setEnabled(false);
        loginModeButton.setEnabled(false);
        registerModeButton.setEnabled(false);
        backButton.setEnabled(false);
        forgotPasswordButton.setEnabled(false);
        resendVerificationButton.setEnabled(false);
        connectionStatus.setText(R.string.auth_status_sending);

        final String networkError = getString(R.string.auth_network_error);
        final String invalidResponseError = getString(R.string.auth_invalid_response);
        networkExecutor.execute(() -> {
            AuthResult result;
            try {
                result = sendAuthRequest(creatingAccount, requestBody);
            } catch (IOException exception) {
                result = new AuthResult(false, networkError, "");
            } catch (JSONException exception) {
                result = new AuthResult(false, invalidResponseError, "");
            }

            AuthResult finalResult = result;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                submitAuthButton.setEnabled(true);
                loginModeButton.setEnabled(true);
                registerModeButton.setEnabled(true);
                backButton.setEnabled(true);
                forgotPasswordButton.setEnabled(true);
                resendVerificationButton.setEnabled(true);
                if (!finalResult.success) {
                    connectionStatus.setText(finalResult.message);
                    return;
                }

                passwordInput.setText("");
                if (creatingAccount) {
                    String serverMessage = finalResult.message.isEmpty()
                            ? getString(R.string.auth_submit_register)
                            : finalResult.message;
                    connectionStatus.setText(
                            serverMessage + "\n\n" + getString(R.string.auth_register_verify_hint)
                    );
                    return;
                }

                String greeting = finalResult.displayName.isEmpty()
                        ? getString(R.string.auth_login_success_generic)
                        : getString(R.string.auth_login_success, finalResult.displayName);
                Toast.makeText(this, greeting, Toast.LENGTH_SHORT).show();
                Intent home = new Intent(this, HomeActivity.class);
                home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(home);
                finish();
            });
        });
    }

    private void resendVerification() {
        String email = emailInput.getText().toString().trim();
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches() || email.length() > 254) {
            emailInput.setError(getString(R.string.password_email_invalid));
            emailInput.requestFocus();
            return;
        }
        submitAuthButton.setEnabled(false);
        loginModeButton.setEnabled(false);
        registerModeButton.setEnabled(false);
        backButton.setEnabled(false);
        forgotPasswordButton.setEnabled(false);
        resendVerificationButton.setEnabled(false);
        connectionStatus.setText(R.string.password_sending);
        networkExecutor.execute(() -> {
            try {
                apiClient.resendVerification(email);
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        connectionStatus.setText(R.string.password_resend_sent);
                    }
                });
            } catch (IOException | JSONException exception) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        connectionStatus.setText(exception instanceof CatalogApiClient.ApiException
                                ? exception.getMessage() : getString(R.string.password_network_error));
                    }
                });
            } finally {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        submitAuthButton.setEnabled(true);
                        loginModeButton.setEnabled(true);
                        registerModeButton.setEnabled(true);
                        backButton.setEnabled(true);
                        forgotPasswordButton.setEnabled(true);
                        resendVerificationButton.setEnabled(true);
                    }
                });
            }
        });
    }

    private AuthResult sendAuthRequest(
            boolean creatingAccount,
            JSONObject requestBody
    ) throws IOException, JSONException {
        String baseUrl = BuildConfig.API_BASE_URL.replaceAll("/+$", "");
        String endpoint = creatingAccount
                ? "/api/v1/auth/register"
                : "/api/v1/auth/login";
        HttpURLConnection connection =
                (HttpURLConnection) new URL(baseUrl + endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setUseCaches(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");

        try {
            byte[] requestBytes = requestBody.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }
            int statusCode = connection.getResponseCode();
            InputStream responseStream = statusCode >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
            String responseText = readResponseBody(responseStream);
            JSONObject responseJson = responseText.isEmpty()
                    ? new JSONObject()
                    : new JSONObject(responseText);

            if (statusCode < 200 || statusCode >= 300) {
                JSONObject error = responseJson.optJSONObject("error");
                String message = error == null ? "" : error.optString("message", "");
                if (message.isEmpty()) {
                    message = getString(R.string.auth_server_error);
                }
                return new AuthResult(false, message, "");
            }

            JSONObject user = responseJson.optJSONObject("user");
            return new AuthResult(
                    true,
                    responseJson.optString("message", ""),
                    user == null ? "" : user.optString("displayName", "")
            );
        } finally {
            connection.disconnect();
        }
    }

    private static String readResponseBody(InputStream input) throws IOException {
        if (input == null) {
            return "";
        }
        StringBuilder responseBody = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                responseBody.append(line);
            }
        }
        return responseBody.toString();
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    private static final class AuthResult {
        private final boolean success;
        private final String message;
        private final String displayName;

        private AuthResult(boolean success, String message, String displayName) {
            this.success = success;
            this.message = message;
            this.displayName = displayName;
        }
    }
}
