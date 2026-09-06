import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site'),
  title: 'Sparkeefy Launch Control',
  description: 'The internal decision dashboard for Sparkeefy’s Android V3 launch.',
  openGraph: {
    title: 'Sparkeefy Launch Control',
    description: 'Earn the right to scale. Track every launch phase and decision gate.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sparkeefy Launch Control',
    description: 'Earn the right to scale. Track every launch phase and decision gate.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
