export function checkAuth(apiKey: string, req: Request): boolean {
	if (!apiKey) return true;
	const auth = req.headers.get("authorization");
	if (auth === `Bearer ${apiKey}`) return true;
	const url = new URL(req.url);
	if (url.searchParams.get("token") === apiKey) return true;
	return false;
}

export function getClientIp(req: Request): string {
	return req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
}
