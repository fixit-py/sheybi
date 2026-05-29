import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <SignUp
        forceRedirectUrl="/"
        fallbackRedirectUrl="/"
        signInUrl="/sign-in"
      />
    </div>
  );
}