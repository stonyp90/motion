import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HeroSection } from '@/components/sections/HeroSection';
import { ProofSection } from '@/components/sections/ProofSection';
import { ValuePillarsSection } from '@/components/sections/ValuePillarsSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { ComparisonSection } from '@/components/sections/ComparisonSection';
import { ArchitectureSection } from '@/components/sections/ArchitectureSection';
import { PricingSection } from '@/components/sections/PricingSection';
import { FAQSection } from '@/components/sections/FAQSection';
import { CTASection } from '@/components/sections/CTASection';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary overflow-x-hidden">
      <Header />
      <HeroSection />
      <ProofSection />
      <ValuePillarsSection />
      <HowItWorksSection />
      <ComparisonSection />
      <ArchitectureSection />
      <PricingSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </main>
  );
}
