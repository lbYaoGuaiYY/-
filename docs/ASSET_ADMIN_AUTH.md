# Asset admin authentication

The asset-admin panel authenticates with the `qingshe_admin_session` HttpOnly,
SameSite cookie issued by `/api/v1/auth/login`. The browser sends it through
credentialed requests; no admin token is included in frontend environment
variables or JavaScript bundles.

Run `sh deploy/asset-cloud/create-runtime-env.sh` when provisioning a new
cloud environment. If admin password material is missing, the script creates
a random password, stores only its PBKDF2 hash in `.env`, and writes the
one-time plaintext to `deploy/asset-cloud/.admin-credentials` with mode 600.
Do not commit or print that file. Delete it after securely handing the
password to the operator. Existing credentials are preserved on subsequent
runs.

Use the login page to establish a session and its “退出登录” control to clear
the cookie. Rotate credentials by replacing `QINGSHE_ADMIN_PASSWORD_SALT`,
`QINGSHE_ADMIN_PASSWORD_HASH`, and `QINGSHE_ADMIN_SESSION_SECRET` in the
server-only `.env`, then restarting the service.
