import prisma from '../src/lib/prisma';

async function main() {
  console.log('🌱 Seeding database...');

  // 카테고리 초기 데이터
  const categories = [
    { name: '수학', icon: '📐' },
    { name: '영어', icon: '🔤' },
    { name: '과학', icon: '🔬' },
    { name: '역사', icon: '📜' },
    { name: '기타', icon: '💡' },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  console.log('✅ Seeded categories');
  console.log('🎉 Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
