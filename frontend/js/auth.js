// =============================================================
// auth.js — Authentication module (Supabase Auth)
// =============================================================
import { supabase } from './config.js';
import { showToast, setButtonLoading } from './utils.js';

// ---- Session ------------------------------------------------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/** Fetch extended profile from public.profiles */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) { console.error('getProfile error:', error); return null; }
  return data;
}

// ---- Login --------------------------------------------------
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ---- Register -----------------------------------------------
export async function register({ email, password, username, phone }) {
  // 1. Sign up with Supabase Auth (trigger creates profile)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.trim(), phone: phone?.trim() ?? '' },
    },
  });
  if (error) throw error;

  // 2. Ensure profile username is unique before returning
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ username: username.trim(), phone: phone?.trim() ?? '' })
      .eq('id', data.user.id);
    if (profileError) {
      console.warn('Profile update warning:', profileError.message);
    }
  }

  return data;
}

// ---- Logout -------------------------------------------------
export async function logout() {
  await supabase.auth.signOut();
  window.location.replace('index.html');
}

// ---- Password reset -----------------------------------------
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/index.html`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// ---- Update profile -----------------------------------------
export async function updateProfile(userId, updates) {
  const allowed = ['username', 'phone', 'avatar_url'];
  const safe = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  const { error } = await supabase.from('profiles').update(safe).eq('id', userId);
  if (error) throw error;
}

// ---- Auth state listener ------------------------------------
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

// ============================================================
// Form handlers (wired in app.js)
// ============================================================

/** Wire up the Login form */
export function bindLoginForm(formId, onSuccess) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const email    = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    setButtonLoading(btn, true, 'Entrar');
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      showToast(err.message ?? 'Error al iniciar sesión', 'error');
    } finally {
      setButtonLoading(btn, false, 'Entrar');
    }
  });
}

/** Wire up the Register form */
export function bindRegisterForm(formId, onSuccess) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = form.querySelector('[type="submit"]');
    const email    = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const confirm  = form.querySelector('[name="confirm_password"]').value;
    const username = form.querySelector('[name="username"]').value.trim();
    const phone    = form.querySelector('[name="phone"]')?.value.trim();

    if (password !== confirm) {
      showToast('Las contraseñas no coinciden', 'warning');
      return;
    }
    if (username.length < 3) {
      showToast('El nombre de usuario debe tener al menos 3 caracteres', 'warning');
      return;
    }
    if (password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'warning');
      return;
    }

    setButtonLoading(btn, true, 'Registrar');
    try {
      const { user } = await register({ email, password, username, phone });
      if (user && !user.confirmed_at) {
        showToast('¡Registro exitoso! Revisa tu email para confirmar tu cuenta.', 'success', 6000);
      } else {
        onSuccess?.();
      }
    } catch (err) {
      showToast(err.message ?? 'Error al registrar', 'error');
    } finally {
      setButtonLoading(btn, false, 'Registrar');
    }
  });
}

/** Wire up the Forgot Password form */
export function bindForgotForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = form.querySelector('[type="submit"]');
    const email = form.querySelector('[name="email"]').value.trim();
    setButtonLoading(btn, true, 'Enviar');
    try {
      await sendPasswordReset(email);
      showToast('Email de recuperación enviado. Revisa tu bandeja.', 'success', 5000);
      form.reset();
    } catch (err) {
      showToast(err.message ?? 'Error al enviar email', 'error');
    } finally {
      setButtonLoading(btn, false, 'Enviar');
    }
  });
}
