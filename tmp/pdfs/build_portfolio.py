from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
import pypdfium2 as pdfium

out = Path(r'D:\ResumeFLOW\job-archives\2026-09-10-campus-applications\范鼎-原子简历项目说明.pdf')
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c = canvas.Canvas(str(out), pagesize=(595.28, 841.89))
c.setTitle('范鼎 | 原子简历项目说明')
c.setAuthor('范鼎')
c.setFillColor(HexColor('#16345d'))
c.setFont('STSong-Light', 24)
c.drawString(48, 784, '原子简历 · AI产品项目说明')
c.setFont('STSong-Light', 11)
c.setFillColor(HexColor('#4b5563'))
c.drawString(48, 757, '范鼎  |  独立开发  |  2026.02 - 至今')
c.setStrokeColor(HexColor('#2563eb'))
c.line(48, 739, 547, 739)
y = 714
style = ParagraphStyle('body', fontName='STSong-Light', fontSize=11, leading=18, textColor=HexColor('#273444'), wordWrap='CJK')

sections = [
 ('产品与问题', '面向需要针对不同岗位调整简历的求职者，解决内容重复改写、经历难复用及岗位匹配耗时的问题。将完整经历拆分为可复用内容模块，通过AI分析与动态组装形成适配岗位的简历。'),
 ('我的职责', '独立完成竞品调研、产品方案与PRD、核心功能开发和上线迭代。调研超级简历、Teal等产品，确立经验原子化存储与动态组装方案，并持续根据用户反馈优化体验。'),
 ('AI能力设计与验证', '对比多种LLM在简历解析与文案润色场景的表现，开展A/B测试。针对JD分析进行Prompt调优，通过结构化输入约束降低输出随机性与评分波动，并将模型能力嵌入实际使用流程。'),
 ('产品迭代', '组织MVP内测，结合用户反馈及行为数据改进排版体验，上线多套简历模板、智能一页排版与微调功能，支持求职者在自动组装基础上进一步调整内容。'),
 ('结果', '产品已上线并跑通完整流程。根据本人简历记录，单份简历组装耗时由约30分钟缩短至1-2分钟。'),
 ('体验入口', '<link href="https://resumeflow.preview.aliyun-zeabur.cn/" color="#2563eb">https://resumeflow.preview.aliyun-zeabur.cn/</link>'),
]
for heading, body in sections:
    c.setFillColor(HexColor('#16345d'))
    c.setFont('STSong-Light', 13)
    c.drawString(48, y, heading)
    y -= 12
    p = Paragraph(body, style)
    w, h = p.wrap(499, 600)
    y -= h
    p.drawOn(c, 48, y)
    y -= 27
c.setFont('STSong-Light', 9)
c.setFillColor(HexColor('#6b7280'))
c.drawString(48, 39, '基于本人已核对简历整理 | 2026年9月10日')
c.save()
doc = pdfium.PdfDocument(str(out))
doc[0].render(scale=1.4).to_pil().save(r'D:\ResumeFLOW\tmp\pdfs\portfolio-preview.png')
print(str(out))
print('pages:',len(doc), 'bottom:',y)
