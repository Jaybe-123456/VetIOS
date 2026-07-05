import { redirect } from 'next/navigation';

export default function ConsoleRedirectPage() {
    redirect('/dashboard');
}
