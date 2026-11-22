import Image from "next/image";

export default function Home() {
  return (
    <>
      <header className="rounded-b-section bg-brown px-6 py-4">
        <Image
          src="/brand/logo-horizontal-light.png"
          alt="Gridcart"
          width={727}
          height={224}
          className="h-12 w-auto"
          priority
        />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight text-brown md:text-6xl">
          Shopping made <span className="text-action">special.</span>
        </h1>
        <p className="text-lg text-muted">
          The Gridcart store is being built. Personalised gifts are coming soon.
        </p>
      </main>
    </>
  );
}
