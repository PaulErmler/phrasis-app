export function LogoSpinner() {
  return <img src="/icons/icon.svg" alt="Flexling" width={72} height={72} />;
}

export function AppLoadingSplash() {
  return (
    <>
      <LogoSpinner />
      <p className="mt-5 text-lg font-semibold text-foreground">Flexling</p>
    </>
  );
}
