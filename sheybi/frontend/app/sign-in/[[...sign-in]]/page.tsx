import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <SignIn
        forceRedirectUrl="/"
        fallbackRedirectUrl="/"
        signUpUrl="/sign-up"
      />
    </div>
  );
}
