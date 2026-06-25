console.log("[bare2] start");
const { dotnet } = await import(new URL("./_framework/dotnet.js", import.meta.url).href);
console.log("[bare2] imported");
self.addEventListener("message", async (e) => {
  console.log("[bare2] got message, creating");
  const rt = await dotnet.create();
  console.log("[bare2] CREATED");
  const cfg = rt.getConfig();
  const ex = await rt.getAssemblyExports(cfg.mainAssemblyName);
  console.log("[bare2] exports", Object.keys(ex.DiatomBloom || {}));
});
