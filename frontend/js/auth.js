// =============================================================
// auth.js — Authentication module (Supabase Auth)
// =============================================================
import { supabase } from './config.js';
import { showToast, setButtonLoading } from './utils.js';

// ---- Error translation ------------------------------------
export function translateError(msg) {
  if (!msg) return 'Error desconocido';
  const m = msg.toLowerCase();
  if (m.includes('anonymous sign-ins are disabled') || m.includes('anonymous'))
    return 'Debes introducir un correo electrónico y contraseña válidos.';
  if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
    return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed'))
    return 'Confirma tu correo electrónico antes de iniciar sesión.';
  if (m.includes('user already registered') || m.includes('already registered') || m.includes('already exists'))
    return 'Ya existe una cuenta con este correo electrónico.';
  if (m.includes('same password') || m.includes('different from the old') || m.includes('should be different'))
    return 'La nueva contraseña debe ser diferente a la anterior.';
  if (m.includes('password should be at least') || m.includes('password must be'))
    return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('invalid format'))
    return 'El formato del correo electrónico no es válido.';
  if (m.includes('email rate limit') || m.includes('rate limit'))
    return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  if (m.includes('email link is invalid') || m.includes('expired'))
    return 'El enlace ha expirado o no es válido. Solicita uno nuevo.';
  if (m.includes('for security purposes') || m.includes('only request this once every 60'))
    return 'Por seguridad, solo puedes solicitarlo una vez cada 60 segundos.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('fetch'))
    return 'Error de conexión. Verifica tu conexión a internet y la configuración de Supabase.';
  if (m.includes('signup is disabled'))
    return 'El registro de nuevos usuarios está desactivado.';
  if (m.includes('weak password'))
    return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
  if (m.includes('user not found'))
    return 'No existe ninguna cuenta con ese correo electrónico.';
  return msg;
}

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

  // Supabase v2: when email confirmations are ON, duplicate emails don't throw
  // an error — instead they return a user with an empty identities array.
  // 409 / duplicate: Supabase v2 returns identities:[] for existing unconfirmed emails
  if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
    throw new Error('Usuario ya registrado con este correo electrónico.');
  }

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
async function checkEmailExists(email) {
  const { data, error } = await supabase.rpc('check_email_exists', { email_input: email });
  if (error) throw error;
  return !!data;
}

export async function sendPasswordReset(email) {
  const base = window.location.href.split('/').slice(0, -1).join('/');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${base}/recuperar.html`,
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
  return supabase.auth.onAuthStateChange((event, session) => callback(session, event));
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
      showToast(translateError(err.message), 'error');
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
    if (!phone) {
      showToast('El teléfono es obligatorio', 'warning');
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
      showToast(translateError(err.message), 'error');
    } finally {
      setButtonLoading(btn, false, 'Registrar');
    }
  });
}

/** Wire up the Forgot Password form (multi-step) */
export function bindForgotForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  function showForgotStep(step) {
    ['1', 'sent', 'unconfirmed', 'newpw'].forEach(s => {
      const el = document.getElementById(`forgot-step-${s}`);
      if (el) el.classList.toggle('hidden', s !== step);
    });
  }

  document.getElementById('forgot-back-sent')?.addEventListener('click', () => showForgotStep('1'));
  document.getElementById('forgot-back-unconfirmed')?.addEventListener('click', () => showForgotStep('1'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = form.querySelector('[type="submit"]');
    const email = form.querySelector('[name="email"]').value.trim();
    if (!email) {
      showToast('Introduce tu correo electrónico', 'warning');
      return;
    }
    setButtonLoading(btn, true, 'Continuar');
    try {
      const exists = await checkEmailExists(email);
      if (!exists) {
        showToast('No existe ninguna cuenta con ese correo electrónico.', 'error');
        return;
      }
      await sendPasswordReset(email);
      document.getElementById('forgot-email-sent').textContent = email;
      showForgotStep('sent');
    } catch (err) {
      const m = (err.message ?? '').toLowerCase();
      if (m.includes('not confirmed') || m.includes('email not confirmed')) {
        // Resend confirmation silently
        try {
          await supabase.auth.resend({ type: 'signup', email });
        } catch (_) { /* silent */ }
        document.getElementById('forgot-email-unconfirmed').textContent = email;
        showForgotStep('unconfirmed');
      } else if (m.includes('user not found') || m.includes('not found')) {
        showToast('No existe ninguna cuenta con ese correo electrónico.', 'error');
      } else {
        showToast(translateError(err.message), 'error');
      }
    } finally {
      setButtonLoading(btn, false, 'Continuar');
    }
  });
}

/** Wire up the New Password form (shown after user clicks recovery link in email) */
export function bindNewPasswordForm(formId, onSuccess) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = form.querySelector('[type="submit"]');
    const password = form.querySelector('[name="password"]').value;
    const confirm  = form.querySelector('[name="confirm_password"]').value;
    if (password !== confirm) {
      showToast('Las contraseñas no coinciden', 'warning');
      return;
    }
    if (password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'warning');
      return;
    }
    setButtonLoading(btn, true, 'Guardar');
    try {
      await updatePassword(password);
      showToast('¡Contraseña actualizada correctamente!', 'success', 4000);
      onSuccess?.();
    } catch (err) {
      showToast(translateError(err.message), 'error');
    } finally {
      setButtonLoading(btn, false, 'Guardar');
    }
  });
}
