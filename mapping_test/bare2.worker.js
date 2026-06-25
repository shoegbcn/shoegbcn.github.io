console.log("[bare2] start");
let dotnet;
self.addEventListener("message", async (e) => {
  console.log("[bare2] got message, creating");
  const rt = await dotnet.create();
  console.log("[bare2] CREATED");
  const cfg = rt.getConfig();
  const ex = await rt.getAssemblyExports(cfg.mainAssemblyName);
  console.log("[bare2] top keys =", Object.keys(ex));
  const Engine = ex.Engine ?? ex.DiatomBloom?.Engine;
  console.log("[bare2] Engine type =", typeof Engine, "Init type =", typeof Engine?.Init);
  Engine.Init("alfacs", 0, 120);
  console.log("[bare2] Init done");
  const keys = Engine.GetSpeciesKeys();
  console.log("[bare2] keys =", keys);
});
({ dotnet } = await import(new URL("./_framework/dotnet.js", import.meta.url).href));
console.log("[bare2] imported, ready for message");
