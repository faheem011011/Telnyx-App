"""Transactional email via Resend."""
import resend

from app.config import settings


def send_verification_email(to_email: str, verify_url: str) -> None:
    resend.api_key = settings.resend_api_key

    resend.Emails.send({
        "from": settings.resend_from_email,
        "to": to_email,
        "subject": "Verify your AlphaCall email address",
        "html": f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#07438C 0%,#1C94AE 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">AlphaCall</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">Verify your email address</h2>
              <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">
                Your AlphaCall account has been created. Click the button below to verify your email and activate your account. This link expires in <strong>24 hours</strong>.
              </p>
              <div style="text-align:center;margin:0 0 32px;">
                <a href="{verify_url}"
                   style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#07438C 0%,#1C94AE 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                  Verify email address
                </a>
              </div>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If you did not expect this email, you can safely ignore it.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin:8px 0 0;word-break:break-all;">
                <a href="{verify_url}" style="color:#07438C;font-size:12px;">{verify_url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; 2026 AlphaCall &mdash; AlphaBridge Consulting
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""",
    })


def send_password_reset_email(to_email: str, reset_url: str) -> None:
    resend.api_key = settings.resend_api_key

    resend.Emails.send({
        "from": settings.resend_from_email,
        "to": to_email,
        "subject": "Reset your AlphaCall password",
        "html": f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#07438C 0%,#1C94AE 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">AlphaCall</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600;">Reset your password</h2>
              <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">
                We received a request to reset the password for your AlphaCall account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
              </p>
              <div style="text-align:center;margin:0 0 32px;">
                <a href="{reset_url}"
                   style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#07438C 0%,#1C94AE 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                  Reset password
                </a>
              </div>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin:8px 0 0;word-break:break-all;">
                <a href="{reset_url}" style="color:#07438C;font-size:12px;">{reset_url}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; 2026 AlphaCall &mdash; AlphaBridge Consulting
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""",
    })
