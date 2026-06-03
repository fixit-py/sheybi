import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-10 font-sans dark:bg-black">
      <SignIn routing="path" signUpUrl="/sign-up" forceRedirectUrl="/home" />
    </main>
  );
}

