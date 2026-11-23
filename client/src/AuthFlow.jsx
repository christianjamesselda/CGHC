import { useState } from 'react';
import { ArrowRight, Check, Church, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react';
import { request } from './api.js';

const empty = { name: '', email: '', password: '', confirmPassword: '', code: '' };

export default function AuthFlow({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(empty);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const submit = async event => {
    event.preventDefault();
    setError(''); setMessage('');
    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('Your passwords do not match.'); return;
    }
    setBusy(true);
    try {
      const result = await request(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'verify' ? { email: form.email, code: form.code } : mode === 'reset' ? { email: form.email, code: form.code, password: form.password } : form),
      });
      if (mode === 'login') {
        localStorage.setItem('church-token', result.token);
        onLogin(result.user);
      } else if (mode === 'register') {
        setMode('verify');
        setMessage(result.message);
      } else if (mode === 'verify') {
        setMode('login');
        setForm(current => ({ ...current, code: '' }));
        setMessage('Email verified. You can now sign in.');
      } else if (mode === 'forgot') {
        setMode('reset');
        setMessage(result.message);
      } else {
        setMode('login');
        setMessage(result.message || 'Password updated. Please sign in.');
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/auth/resend', { method: 'POST', body: JSON.stringify({ email: form.email }) });
      setMessage(result.message);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const titles = {
    register: ['Create your account', 'Join your church workspace.'],
    verify: ['Check your inbox', `We sent a 6-digit verification code to ${form.email}.`],
    login: ['Welcome back', 'Sign in to your church workspace.'],
    forgot: ['Reset your password', 'We’ll send a reset code to your email.'],
    reset: ['Choose a new password', 'Enter the reset code and your new password.'],
  };
  const [title, subtitle] = titles[mode];

  return <div className="auth-layout">
    <div className="auth-story">
      <div className="brand auth-brand"><div className="brand-mark"><Church size={20}/></div><div><strong>Cornerstone</strong><small>Church workspace</small></div></div>
      <div className="auth-story-content"><span className="eyebrow light-eyebrow">A HOME FOR YOUR MINISTRY</span><h1>Make room for<br/><em>what matters.</em></h1><p>Keep your people, worship, and weekly rhythm connected in one thoughtful place.</p><div className="auth-quote"><span>“</span><div><p>Let all that you do be done in love.</p><small>1 CORINTHIANS 16:14</small></div></div></div>
      <div className="auth-footer">Cornerstone Global Harvest Church <span>·</span> Built for the way we serve</div>
    </div>
    <div className="auth-panel"><div className="auth-card">
      <div className="auth-mobile-mark"><div className="brand-mark"><Church size={20}/></div><span>Cornerstone</span></div>
      <div className="eyebrow">{mode === 'verify' ? 'ONE LAST STEP' : 'CORNERSTONE GLOBAL HARVEST CHURCH'}</div>
      <h2>{title}</h2><p className="muted">{subtitle}</p>
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && <Field label="Full name"><input autoComplete="name" value={form.name} onChange={e => change('name', e.target.value)} placeholder="Your name" required minLength={2}/></Field>}
        {['register','login','forgot'].includes(mode) && <Field label="Email address"><input autoComplete="email" type="email" value={form.email} onChange={e => change('email', e.target.value)} placeholder="you@example.com" required/></Field>}
        {mode === 'register' && <>
          <PasswordField label="Create password" name="password" value={form.password} onChange={value => change('password', value)} visible={showPassword} onToggle={() => setShowPassword(v => !v)} autoComplete="new-password"/>
          <PasswordField label="Confirm password" name="confirmPassword" value={form.confirmPassword} onChange={value => change('confirmPassword', value)} visible={showConfirm} onToggle={() => setShowConfirm(v => !v)} autoComplete="new-password"/>
          <p className="password-hint">Use at least 8 characters.</p>
        </>}
        {mode === 'login' && <PasswordField label="Password" name="password" value={form.password} onChange={value => change('password', value)} visible={showPassword} onToggle={() => setShowPassword(v => !v)} autoComplete="current-password"/>}
        {mode === 'verify' && <><div className="verification-mail"><span><Mail size={17}/></span><div><b>Verification email sent</b><small>Check your inbox and spam folder.</small></div></div><SixDigitCode value={form.code} onChange={value => change('code', value)}/></>}
        {mode === 'reset' && <><Field label="Email address"><input type="email" value={form.email} onChange={e => change('email', e.target.value)} required/></Field><SixDigitCode value={form.code} onChange={value => change('code', value)}/><PasswordField label="New password" name="password" value={form.password} onChange={value => change('password', value)} visible={showPassword} onToggle={() => setShowPassword(v => !v)} autoComplete="new-password"/></>}
        {error && <div className="alert error-alert">{error}</div>}
        {message && <div className="alert success-alert">{message}</div>}
        <button className="btn btn-primary full-btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Send verification code' : mode === 'verify' ? 'Verify email' : mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Send reset code' : 'Update password'}<ArrowRight size={16}/></button>
      </form>
      {mode === 'verify' && <button className="resend-code" type="button" disabled={busy} onClick={resend}>Didn’t receive a code? <b>Resend code</b></button>}
      <div className="auth-switch">
        {mode === 'register' && <span>Already have an account? <button onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Sign in</button></span>}
        {mode === 'login' && <><button onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button><span>New to Cornerstone? <button onClick={() => { setMode('register'); setError(''); setMessage(''); }}>Create an account</button></span></>}
        {mode === 'verify' && <span>Already verified? <button onClick={() => setMode('login')}>Sign in</button></span>}
        {['forgot','reset'].includes(mode) && <span><button onClick={() => { setMode(mode === 'forgot' ? 'reset' : 'login'); setError(''); }}> {mode === 'forgot' ? 'I have a reset code' : 'Back to sign in'}</button></span>}
      </div>
      <div className="secure-note"><ShieldCheck size={15}/> Your information is kept secure</div>
    </div></div>
  </div>;
}

function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function PasswordField({ label, name, value, onChange, visible, onToggle, autoComplete }) {
  return <Field label={label}><span className="password-input-wrap"><input name={name} type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder="At least 8 characters" minLength={8} required autoComplete={autoComplete}/><button className="password-toggle" type="button" onClick={onToggle} aria-label={visible ? 'Hide password' : 'Show password'} title={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></Field>;
}
function SixDigitCode({ value, onChange }) {
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const update = (index, char) => {
    const next = [...digits]; next[index] = char.replace(/\D/g, '').slice(-1) || ' ';
    onChange(next.join('').replaceAll(' ', ''));
    if (char && index < 5) document.getElementById(`verify-digit-${index + 1}`)?.focus();
  };
  return <div className="six-code-field"><label>6-digit verification code</label><div className="six-code-inputs" onPaste={e => { const pasted=e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6); if(pasted){e.preventDefault();onChange(pasted);document.getElementById('verify-digit-5')?.focus();} }}>
    {digits.map((digit,index)=><input id={`verify-digit-${index}`} key={index} aria-label={`Verification digit ${index+1}`} inputMode="numeric" autoComplete={index===0?'one-time-code':'off'} maxLength={6} value={digit.trim()} required={index===0} onChange={e=>{if(e.target.value.length>1){const pasted=e.target.value.replace(/\D/g,'').slice(0,6);onChange(pasted);document.getElementById(`verify-digit-${Math.min(pasted.length,5)}`)?.focus();}else update(index,e.target.value);}} onKeyDown={e=>{if(e.key==='Backspace'&&!digits[index]&&index>0)document.getElementById(`verify-digit-${index-1}`)?.focus();if(e.key==='ArrowLeft'&&index>0)document.getElementById(`verify-digit-${index-1}`)?.focus();if(e.key==='ArrowRight'&&index<5)document.getElementById(`verify-digit-${index+1}`)?.focus();}}/>)}
  </div><input className="code-hidden" name="code" value={value} onChange={()=>{}} tabIndex={-1} aria-hidden="true"/></div>;
}
