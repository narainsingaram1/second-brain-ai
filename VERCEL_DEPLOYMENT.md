# 🚀 Deploying Synapse Second Brain on Vercel

Synapse Second Brain is configured for **1-click Git deployment** to Vercel with full cloud account authentication (Email/Password Sign-Up, Sign-In, Password Reset, and Google OAuth) powered by Supabase.

---

## ⚡ Quick Start: Deploy from Git to Vercel

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "feat: configure Vercel deployment with full auth"
   git push origin main
   ```

2. **Import into Vercel**:
   - Go to [vercel.com](https://vercel.com) and log in.
   - Click **"Add New..."** > **"Project"**.
   - Select your GitHub repository (`second-brain-ai`).
   - Framework Preset: **Vite** (auto-detected).
   - Build Command: `npm run build` (auto-detected).
   - Output Directory: `dist` (auto-detected).

3. **Environment Variables**:
   The application automatically bundles with the pre-configured Supabase project (`sgacmfewjzmhixewqpad`).
   
   If you wish to customize environment variables in Vercel:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `VITE_SUPABASE_URL` | `https://sgacmfewjzmhixewqpad.supabase.co` | Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_ka6-aemxLBgnBFywALxfWw_dGLJc7CW` | Supabase Public Key |
   | `VITE_AUTH_PROVIDER` | `supabase` | Enables managed account portal |
   | `VITE_OPENROUTER_API_KEY` | *(optional)* | Global fallback OpenRouter AI key (users can also enter theirs in Settings) |
   | `VITE_GOOGLE_CLIENT_ID` | *(optional)* | Google Web Client ID for Google Identity Services |

4. Click **"Deploy"**!
   Vercel will build and assign your live production URL: `https://<your-project>.vercel.app`.

---

## 🔐 Authentication Features

### 1. Email & Password Sign-Up / Login
- Users can create accounts with **Full Name**, **Email**, and **Password** (min 8 characters).
- Password hashing and session management are handled securely by Supabase with PKCE tokens.
- Each user gets their own isolated private second brain stored in PostgreSQL with row-level security.
- Includes **Forgot Password** and **Password Reset** email recovery flows.

### 2. Google Sign-In (OAuth)
To activate Google Sign-In for your live Vercel domain:

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Go to **APIs & Services** > **Credentials**.
   - Under OAuth 2.0 Client IDs, open or create your **Web application** client.
   - **Authorized JavaScript origins**:
     - `https://<your-project>.vercel.app`
     - `http://localhost:5173` (for local web testing)
   - **Authorized redirect URIs**:
     - `https://sgacmfewjzmhixewqpad.supabase.co/auth/v1/callback`
   - Copy your **Client ID** and **Client Secret**.

2. **Supabase Dashboard** ([supabase.com/dashboard](https://supabase.com/dashboard/project/sgacmfewjzmhixewqpad)):
   - Open your project: `iris-second-brain` (`sgacmfewjzmhixewqpad`).
   - Go to **Authentication** > **Providers** > **Google**.
   - Toggle **Enable Google provider** to ON.
   - Paste your **Client ID** and **Client Secret**.
   - Under **URL Configuration**:
     - Set **Site URL** to: `https://<your-project>.vercel.app`
     - Add `https://<your-project>.vercel.app/**` to **Redirect URLs**.
   - Click **Save**.

Once enabled, clicking **"Continue with Google"** will immediately redirect users through Google's official sign-in screen and return them authenticated to your deployed Synapse app!

### 3. Guest Offline Mode
- Users can also click **"Continue as Guest"** on the auth screen to explore the app immediately using local offline storage without signing in.

---

## 📁 Key Deployment Files

- `vercel.json`: Handles SPA client-side routing rewrites (`/(.*)` -> `/index.html`) so refreshing on any page or returning from OAuth redirects loads without 404 errors.
- `vite.config.ts`: Injects public Supabase configuration automatically so Vercel builds out of the box with zero manual environment variable setup.
- `src/components/ManagedRoot.tsx`: The sign-up / login / Google Auth screen with ambient silk ribbons and dark/light mode.
- `src/components/ManagedAccountModal.tsx`: Account management dialog showing user profile, sync state, and sign out controls.
