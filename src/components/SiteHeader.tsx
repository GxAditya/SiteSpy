import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Building2, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const links = [
  { to: "/", label: "Search" },
  { to: "/monitor", label: "Monitor" },
  { to: "/about", label: "How it works" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <header className={`floating-header no-print ${scrolled ? "is-scrolled" : ""}`}>
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 md:px-6">
        <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5" aria-label="SiteSpy home">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Building2 size={21} /></span>
          <span className="text-xl font-bold">Site<span className="text-primary">Spy</span></span>
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {links.map((link) => <Link key={link.to} to={link.to} className="nav-link" activeProps={{ className: "nav-link active" }} activeOptions={{ exact: true }}>{link.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden border-primary/20 bg-primary/5 text-primary sm:inline-flex"><Link to="/settings">API settings <ArrowUpRight /></Link></Button>
          <Button size="icon" variant="ghost" className="md:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>
        </div>
      </div>
      {open && <nav id="mobile-navigation" aria-label="Mobile navigation" className="mobile-nav border-t border-border p-3 md:hidden">
        {links.map((link) => <Link key={link.to} to={link.to} onClick={() => setOpen(false)} className="nav-link" activeProps={{ className: "nav-link active" }} activeOptions={{ exact: true }}>{link.label}</Link>)}
        <Link to="/settings" className="nav-link" onClick={() => setOpen(false)}>API settings</Link>
      </nav>}
    </header>
  );
}
