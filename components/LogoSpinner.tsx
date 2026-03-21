import Image from 'next/image';

export function LogoSpinner() {
  return <Image src="/icons/icon.svg" alt="Flexling" width={72} height={72} />;
}

export function AppLoadingSplash() {
  return (
    <>
      <LogoSpinner />
      <p className="mt-5 text-lg font-semibold text-foreground">Flexling</p>
    </>
  );
}
