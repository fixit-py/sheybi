import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-10 font-sans dark:bg-black">
      <SignUp routing="path" signInUrl="/sign-in" forceRedirectUrl="/user" />
    </main>
  );
}

