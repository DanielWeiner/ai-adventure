import './globals.css';
import React from 'react';
import Header from './header';
import Main from './main';
import { getSession } from './api/auth';

export const metadata = {
  title: 'AI Adventure',
  description: 'Create an AI Adventure.',
};

export default async function RootLayout({ children } : { children : React.ReactNode }) {
  const session = await getSession();
  const userName = session?.user?.name || "";
  const userEmail = session?.user?.email || "";
  const userImage = session?.user?.image || "";
  const loggedIn = !!userEmail;

  return (
    <html lang="en">
      <body className={`flex flex-col max-h-screen min-h-screen h-screen bg-slate-100`}>
        <Header loggedIn={loggedIn} userName={userName} userImage={userImage}/>
        <Main>
          {children}
        </Main>
      </body>
    </html>
  )
}
