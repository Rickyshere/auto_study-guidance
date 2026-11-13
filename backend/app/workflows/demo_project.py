from __future__ import annotations

import uuid
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from PIL import Image, ImageDraw

from app.config import get_project_dir
from app.parsers.pptx_parser import parse_pptx
from app.schemas import DocumentIR, RouterSettings


async def create_demo_courseware_project(settings: RouterSettings) -> DocumentIR:
    """Create a realistic sample PPTX courseware project on disk and parse it."""
    project_id = f"demo_{uuid.uuid4().hex[:6]}"
    pdir = get_project_dir(project_id)
    assets_dir = pdir / "assets"

    # Generate a clean educational diagram PNG to embed into the sample PPTX
    diag_path = pdir / "transformer_flow.png"
    img = Image.new("RGB", (720, 320), color=(248, 250, 252))
    draw = ImageDraw.Draw(img)
    boxes = [
        (40, 110, 180, 200, "Input Embedding\n+ Pos Encoding", (219, 234, 254), (37, 99, 235)),
        (240, 110, 410, 200, "Multi-Head\nSelf-Attention", (220, 252, 231), (22, 163, 74)),
        (470, 110, 670, 200, "Feed-Forward\n& LayerNorm", (254, 243, 199), (217, 119, 6)),
    ]
    for x1, y1, x2, y2, label, fill, outline in boxes:
        draw.rectangle([x1, y1, x2, y2], fill=fill, outline=outline, width=3)
        draw.text((x1 + 14, y1 + 26), label, fill=(15, 23, 42))
    draw.line([(180, 155), (240, 155)], fill=(71, 85, 105), width=3)
    draw.line([(410, 155), (470, 155)], fill=(71, 85, 105), width=3)
    draw.text((40, 28), "Transformer Encoder Core Pipeline", fill=(30, 41, 59))
    img.save(diag_path)

    prs = Presentation()
    slides_spec = [
        {
            "title": "第1章 神经网络基础与梯度下降",
            "bullets": [
                "感知机与多层前馈网络：通过线性变换与非线性激活函数逼近复杂映射。",
                "激活函数：ReLU 有效缓解梯度消失问题，Sigmoid 常用于二分类输出层。",
                "反向传播算法：利用链式法则自顶向下计算损失函数对各层参数的偏导数。",
                "优化器演进：SGD、Momentum、Adam 自适应学习率优化机制。",
            ],
            "notes": "课堂提示：务必向学生强调为何需要非线性激活函数，否则多层网络等价于单层线性变换。",
            "table": [
                ["激活函数", "值域", "核心优点", "常见缺陷"],
                ["Sigmoid", "(0, 1)", "概率解释直观", "深层易梯度消失"],
                ["ReLU", "[0, +∞)", "计算高效、收敛快", "存在 Dead ReLU 现象"],
            ],
        },
        {
            "title": "第2章 卷积神经网络 (CNN) 与特征提取",
            "bullets": [
                "局部感受野：卷积核仅与输入图像的局部区域连接，大幅减少参数量。",
                "权值共享：同一卷积核在空间位置滑动共享权重，具备平移等变性。",
                "池化层 (Pooling)：通过 Max Pooling 或 Average Pooling 降低空间维度并提升鲁棒性。",
                "经典架构：ResNet 引入残差连接 y = F(x) + x 解决深层网络退化问题。",
            ],
            "notes": "重点考题：计算卷积输出特征图尺寸公式 (W - K + 2P)/S + 1。",
            "table": None,
        },
        {
            "title": "第3章 注意力机制与 Transformer 架构",
            "bullets": [
                "Scaled Dot-Product Attention：通过 Query、Key、Value 计算权重，缩放因子 sqrt(d_k) 防止梯度饱和。",
                "多头注意力 (Multi-Head Attention)：在多个子空间并行捕获不同维度的语义关联。",
                "位置编码 (Positional Encoding)：为无递归结构的序列注入位置顺序信息。",
                "残差与层归一化 (Add & Norm)：稳定深层 Transformer 的训练动态。",
            ],
            "notes": "对比 RNN 与 Transformer 的并行训练效率差异。",
            "table": None,
            "image": diag_path,
        },
        {
            "title": "第4章 模型泛化、正则化与训练调优",
            "bullets": [
                "过拟合与欠拟合：训练集准确率高但验证集下降属于过拟合。",
                "Dropout 正则化：训练阶段按概率随机失活神经元，测试阶段按比例缩放。",
                "L2 权重衰减：在损失函数中加入权重平方惩罚项，限制模型复杂度。",
                "早停法 (Early Stopping) 与学习率调度 (Cosine Annealing) 实战策略。",
            ],
            "notes": "期末常考对比题：BatchNorm 与 LayerNorm 的适用场景区分。",
            "table": None,
        },
    ]

    for spec in slides_spec:
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = spec["title"]
        tf = slide.placeholders[1].text_frame
        tf.clear()
        for idx, b in enumerate(spec["bullets"]):
            p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
            p.text = b
            p.font.size = Pt(14)

        if spec.get("table"):
            t_data = spec["table"]
            table_shape = slide.shapes.add_table(
                len(t_data), len(t_data[0]), Inches(0.8), Inches(4.5), Inches(8.2), Inches(1.8)
            )
            for r_i, row in enumerate(t_data):
                for c_i, val in enumerate(row):
                    table_shape.table.cell(r_i, c_i).text = val

        if spec.get("image"):
            slide.shapes.add_picture(str(spec["image"]), Inches(1.2), Inches(4.6), width=Inches(6.8))

        if spec.get("notes"):
            slide.notes_slide.notes_text_frame.text = spec["notes"]

    pptx_path = pdir / "深度学习核心架构讲义_示例课件.pptx"
    prs.save(str(pptx_path))

    # Clean temp diagram source outside assets
    diag_path.unlink(missing_ok=True)
    return await parse_pptx(pptx_path, project_id, assets_dir, settings)
