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
        <main className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md mx-auto flex justify-center">
                <AuthView 
                    path={path} 
                    localization={authLocalization} 
                    redirectTo="/app"
                    classNames={{
                        // Keep the base as is, don't reverse the whole card
                        base: "w-full",
                        // Target the content area specifically (may need adjustment based on actual DOM structure)
                        content: "flex flex-col-reverse"
                    }}
                />
            </div>
        </main>
    )
}
