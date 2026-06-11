import { Route, Routes, Link, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "@cloudflare/kumo/components/sidebar";
import { ToastProvider } from "@cloudflare/kumo/components/toast";
import { VinylRecordIcon, PuzzlePieceIcon, PaperPlaneTiltIcon, GearIcon } from "@phosphor-icons/react";
import CollectionPage from "./pages/CollectionPage";
import ExtensionsPage from "./pages/ExtensionsPage";
import SubmitPage from "./pages/SubmitPage";
import AdminPage from "./pages/AdminPage";
import ExtensionDetailPage from "./pages/ExtensionDetailPage";
import { useEffect, useState } from "react";
import { api, type Extension } from "./lib/api";
import { CodePreloader } from "./components/CodePreloader";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    api.listExtensions().then((r) => setExtensions(r.extensions)).catch(() => {});
  }, [location.pathname]);

  const isActive = (p: string) =>
    p === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(p);

  return (
    <ToastProvider>
      <Sidebar.Provider defaultOpen>
        <div className="flex min-h-screen bg-kumo-base text-kumo-default">
          <Sidebar>
            <Sidebar.Header>
              <div className="flex items-center gap-2 px-2 py-1 text-sm font-semibold tracking-tight">
                <span className="inline-block size-6 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 ring-2 ring-black/30" />
                Vinyl
              </div>
            </Sidebar.Header>
            <Sidebar.Content>
              <Sidebar.Group>
                <Sidebar.GroupLabel>Library</Sidebar.GroupLabel>
                <Sidebar.Menu>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={VinylRecordIcon}
                      active={isActive("/")}
                      onClick={() => navigate("/")}
                    >
                      Collection
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={PuzzlePieceIcon}
                      active={isActive("/extensions")}
                      onClick={() => navigate("/extensions")}
                    >
                      Extensions
                      <Sidebar.MenuBadge>{extensions.length}</Sidebar.MenuBadge>
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={PaperPlaneTiltIcon}
                      active={isActive("/submit")}
                      onClick={() => navigate("/submit")}
                    >
                      Submit
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      icon={GearIcon}
                      active={isActive("/admin")}
                      onClick={() => navigate("/admin")}
                    >
                      Admin
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                </Sidebar.Menu>
              </Sidebar.Group>
            </Sidebar.Content>
            <Sidebar.Footer>
              <div className="px-2 py-2 text-[11px] text-kumo-subtle">
                Built for the Agent Era
              </div>
            </Sidebar.Footer>
          </Sidebar>

          <main className="flex-1 min-w-0">
            <Routes>
              <Route path="/" element={<CollectionPage />} />
              <Route path="/extensions" element={<ExtensionsPage />} />
              <Route path="/submit" element={<SubmitPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/extensions/:id" element={<ExtensionDetailPage />} />
              <Route
                path="*"
                element={
                  <div className="p-12 text-kumo-subtle">
                    Not found. <Link to="/" className="underline">Back to collection</Link>
                  </div>
                }
              />
            </Routes>
          </main>
        </div>
      </Sidebar.Provider>

      {/* Ensures CodeHighlighted is included in the bundle for Phase 2 — hidden. */}
      <CodePreloader />
    </ToastProvider>
  );
}
