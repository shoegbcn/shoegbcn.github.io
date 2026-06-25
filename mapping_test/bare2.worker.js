console.log("[bare2] start");
let dotnet;
self.addEventListener("message", async (e) => {
  console.log("[bare2] got message, creating");
  const rt = await dotnet.create();
  console.log("[bare2] CREATED");
  const cfg = rt.getConfig();
  const ex = await rt.getAssemblyExports(cfg.mainAssemblyName);
  console.log("[bare2] exports", Object.keys(ex || {}), "DiatomBloom =", Object.keys(ex.DiatomBloom || {}));
  const Engine = ex.DiatomBloom.Engine;
  console.log("[bare2] Engine type =", typeof Engine);
  console.log("[bare2] calling Init");
  Engine.Init("alfacs", 0, 120);
  console.log("[bare2] Init done");
  const keys = Engine.GetSpeciesKeys();
  console.log("[bare2] keys =", keys);
});
({ dotnet } = await import(new URL("./_framework/dotnet.js", import.meta.url).href));
console.log("[bare2] imported, ready for message");
