'use client';

import TabbedAuthForm from '@/components/auth/TabbedAuthForm';

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
      <TabbedAuthForm
        onSuccess={(email) => {
          console.log('User signed up/in:', email);
          // Handle redirect or other logic here
        }}
      />
    </div>
  );
}