import { AuthView } from "@daveyplate/better-auth-ui"
import { authViewPaths } from "@daveyplate/better-auth-ui/server"
import { getMessages } from "next-intl/server"

export const dynamicParams = false

export function generateStaticParams() {
    return Object.values(authViewPaths).map((path) => ({ path }))
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
    const { path } = await params
    const messages = await getMessages()
    const authLocalization = (messages.Auth as Record<string, string>) || {}
    
    return (
        <main className="min-h-screen flex items-center justify-center p-4 md:p-6">
            <div className="w-full max-w-md">
                <AuthView path={path} localization={authLocalization} />
            </div>
        </main>
    )
}
