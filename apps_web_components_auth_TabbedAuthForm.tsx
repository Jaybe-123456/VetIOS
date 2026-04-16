'use client';

import React, { useState } from 'react';
import { Mail, Lock, CheckCircle, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AuthTab = 'signup' | 'signin';
type FormState = {
  email: string;
  password: string;
  confirmPassword: string;
};

type AuthError = {
  field?: string;
  message: string;
};

interface TabbedAuthFormProps {
  edgeUrl?: string;
  onSuccess?: (email: string) => void;
}

export default function TabbedAuthForm({ 
  edgeUrl, 
  onSuccess 
}: TabbedAuthFormProps) {
  const fallbackUrl =
    (process.env.NEXT_PUBLIC_EDGE_URL as string | undefined) ||
    (process.env.REACT_APP_EDGE_URL as string | undefined) ||
    '<EDGE_FUNCTION_URL>';
  const endpoint = edgeUrl ?? fallbackUrl;

  const [activeTab, setActiveTab] = useState<AuthTab>('signup');
  const [form, setForm] = useState<FormState>({
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const validateSignup = (): AuthError | null => {
    if (!form.email) return { field: 'email', message: 'Email is required' };
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      return { field: 'email', message: 'Invalid email format' };
    }
    
    if (form.password.length < 8) {
      return { field: 'password', message: 'Password must be at least 8 characters' };
    }
    
    if (form.password !== form.confirmPassword) {
      return { field: 'confirmPassword', message: 'Passwords do not match' };
    }
    
    return null;
  };

  const validateSignin = (): AuthError | null => {
    if (!form.email) return { field: 'email', message: 'Email is required' };
    if (!form.password) return { field: 'password', message: 'Password is required' };
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const validation = activeTab === 'signup' ? validateSignup() : validateSignin();
    if (validation) {
      setError(validation);
      return;
    }

    setLoading(true);
    try {
      const payload = activeTab === 'signup'
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          (data && (data.error || data.message)) ||
          `Request failed with status ${res.status}`;
        setError({ message });
        return;
      }

      const successMsg = activeTab === 'signup'
        ? 'Account created successfully! Check your inbox for confirmation.'
        : 'Signed in successfully!';
      
      setSuccessMessage(successMsg);
      setForm({ email: '', password: '', confirmPassword: '' });
      
      if (onSuccess) {
        onSuccess(form.email);
      }
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const isSignup = activeTab === 'signup';
  const isPasswordValid = form.password.length >= 8;
  const isConfirmPasswordValid = form.password === form.confirmPassword && isPasswordValid;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Tabbed Navigation */}
      <div className="flex gap-2 mb-8 bg-slate-100 dark:bg-slate-900/50 p-1 rounded-lg">
        {(['signup', 'signin'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setError(null);
              setSuccessMessage(null);
            }}
            className={`
              flex-1 py-2.5 px-4 rounded-md font-medium text-sm
              transition-all duration-200 uppercase tracking-wide
              ${activeTab === tab
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }
            `}
          >
            {tab === 'signup' ? '✨ Create Account' : '🔐 Sign In'}
          </button>
        ))}
      </div>

      {/* Form Container */}
      <div className="bg-white dark:bg-slate-950 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30 px-6 py-6 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {isSignup ? 'Create Your Account' : 'Welcome Back'}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isSignup
              ? 'Join VetIOS for AI-powered veterinary diagnostics'
              : 'Access your VetIOS platform'}
          </p>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Error Alert */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg animate-in slide-in-from-top">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  {error.field ? `${error.field}: ` : ''}{error.message}
                </p>
              </div>
            </div>
          )}

          {/* Success Alert */}
          {successMessage && (
            <div className="flex items-start gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg animate-in slide-in-from-top">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {successMessage}
              </p>
            </div>
          )}

          {/* Email Field */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-500" />
                Email Address
              </span>
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={onChange}
              placeholder="you@example.com"
              required
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-500" />
                Password
              </span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={onChange}
                placeholder="••••••••"
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            
            {/* Password Strength Indicator (Signup only) */}
            {isSignup && form.password && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex gap-1 flex-1">
                  <div
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      form.password.length >= 8
                        ? 'bg-green-500'
                        : 'bg-red-500'
                    }`}
                  />
                  {form.password.length >= 12 && (
                    <div className="h-1 flex-1 rounded-full bg-green-500" />
                  )}
                  {form.password.length >= 16 && (
                    <div className="h-1 flex-1 rounded-full bg-green-500" />
                  )}
                </div>
                <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {form.password.length < 8 ? 'Weak' : 'Strong'}
                </span>
              </div>
            )}
          </div>

          {/* Confirm Password Field (Signup only) */}
          {isSignup && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-500" />
                  Confirm Password
                </span>
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={onChange}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              
              {/* Password Match Indicator */}
              {form.confirmPassword && (
                <div className={`flex items-center gap-2 text-xs ${
                  isConfirmPasswordValid
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {isConfirmPasswordValid ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Passwords match
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5" />
                      Passwords don't match
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 py-2.5 px-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-500 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl disabled:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isSignup ? 'Creating Account...' : 'Signing In...'}
              </>
            ) : (
              <>
                {isSignup ? '✨ Create Account' : '🔐 Sign In'}
              </>
            )}
          </button>

          {/* Footer Info */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
              By continuing, you agree to our{' '}
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">
                Terms of Service
              </a>
              {' '}and{' '}
              <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">
                Privacy Policy
              </a>
            </p>
          </div>
        </form>
      </div>

      {/* Additional Help Text */}
      <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
        {isSignup ? (
          <>
            Already have an account?{' '}
            <button
              onClick={() => {
                setActiveTab('signin');
                setError(null);
                setSuccessMessage(null);
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Sign in instead
            </button>
          </>
        ) : (
          <>
            Don't have an account?{' '}
            <button
              onClick={() => {
                setActiveTab('signup');
                setError(null);
                setSuccessMessage(null);
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Create one now
            </button>
          </>
        )}
      </div>
    </div>
  );
}